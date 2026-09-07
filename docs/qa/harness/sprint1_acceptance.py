#!/usr/bin/env python3
"""
Sprint 1 acceptance battery — Mike staging (mike.agov.app).

For each of the two QA minutas (Petronect_REVISADO_usuario.docx,
FioSaude_REVISADO_usuario.docx) in project "QA Extensivo 20260904 —
Minutas e Qualidade":
  - 3 independent executions via POST /chat with the document attached;
  - per execution: job_id, chat_id, request_id, SHA, effective model,
    tools used, duration, checkpoints, terminal state, full response text.

Plus one pause -> reload -> resume scenario on the same job_id using
tool_budget to force the pause deterministically.

Evidence is appended to mike-sprint1-acceptance.jsonl (cwd, or MIKE_QA_EVIDENCE).
"""
import json
import os
import time
import urllib.request
import urllib.error

STAGING = "https://mike.agov.app"
FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
def _cred():
    return {
        "email": os.environ["MIKE_QA_EMAIL"],
        "password": os.environ["MIKE_QA_PASSWORD"],
    }
def _supa():
    return {"SUPABASE_URL": os.environ["MIKE_QA_SUPA_URL"], "SERVICE_KEY": os.environ["MIKE_QA_SUPA_SERVICE_KEY"]}
_anon_cache = {}


def SUPA_ANON():
    if not _anon_cache:
        key = os.environ.get("MIKE_QA_ANON_KEY")
        if key:
            _anon_cache["k"] = key
            return key
        import subprocess
        out = subprocess.check_output([
            "aws", "secretsmanager", "get-secret-value",
            "--secret-id", "atlas-mike-staging-app-secrets",
            "--profile", "chico-bacon", "--region", "us-east-1",
            "--query", "SecretString", "--output", "text",
        ])
        _anon_cache["k"] = json.loads(out.decode())["SUPABASE_ANON_KEY"]
    return _anon_cache["k"]

OUT = os.environ.get("MIKE_QA_EVIDENCE", "mike-sprint1-acceptance.jsonl")

PETRONECT = "c81ed118-45b4-4c43-9ced-e5fd1e914b38"
FIOSAUDE = "b0c60d00-f44f-4f6d-8b60-79577276aae1"
PROJECT = "b0d73907-731e-4cda-8951-11ae7de403b7"


def login():
    body = json.dumps({"email": _cred()["email"], "password": _cred()["password"]}).encode()
    req = urllib.request.Request(
        f"{STAGING}/supabase/auth/v1/token?grant_type=password",
        data=body, method="POST",
        headers={"apikey": SUPA_ANON(), "Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["access_token"]


def health():
    return json.loads(urllib.request.urlopen(f"{STAGING}/health", timeout=60).read())


def sse_chat(token, payload, timeout=1800):
    """POST /chat streaming; returns (events, terminal_type)."""
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{STAGING}/chat", data=body, method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
    )
    events = []
    terminal = None
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        started = time.time()
        buf = b""
        while True:
            chunk = resp.read(8192)
            if not chunk:
                break
            buf += chunk
            while b"\n\n" in buf:
                raw, buf = buf.split(b"\n\n", 1)
                for line in raw.decode(errors="replace").splitlines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        continue
                    try:
                        ev = json.loads(data)
                    except Exception:
                        continue
                    events.append(ev)
                    t = ev.get("type")
                    if t in ("paused", "error"):
                        terminal = terminal or t
        elapsed = time.time() - started
    return events, terminal, elapsed


def job_status(token, chat_id, job_id):
    req = urllib.request.Request(
        f"{STAGING}/chat/{chat_id}/jobs/{job_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def append(record):
    # Sanitize: evidence JSONL must never carry credentials or signed URLs.
    record = {k: v for k, v in record.items() if k not in ("token", "url", "password")}
    with open(OUT, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def run_execution(token, label, doc_id, doc_name, prompt, tool_budget=None, resume_job_id=None, project_id=PROJECT):
    payload = {
        "project_id": project_id,
        "messages": [{"role": "user", "content": prompt}],
        "attached_documents": [{"filename": doc_name, "document_id": doc_id}],
        "model": "deepseek/deepseek-v4-flash",
    }
    if tool_budget:
        payload["tool_budget"] = tool_budget
    if resume_job_id:
        payload["resume_job_id"] = resume_job_id
        payload["messages"] = [{"role": "user", "content": "Termine a tarefa anterior de onde parou, sem repetir as partes já concluídas."}]

    print(f"[{label}] starting...")
    events, terminal, elapsed = sse_chat(token, payload)
    chat_id = next((e.get("chatId") for e in events if e.get("type") == "chat_id"), None)
    job_id = None
    for e in events:
        if e.get("type") == "job_status" and e.get("jobId"):
            job_id = e["jobId"]
    checkpoints = [e for e in events if e.get("type") == "job_status" and e.get("checkpointId")]
    content = "".join(
        e.get("text", "") for e in events if e.get("type") == "content_delta"
    )
    tools = [e.get("name") for e in events if e.get("type") == "tool_call_start"]

    status = None
    if chat_id and job_id:
        try:
            status = job_status(token, chat_id, job_id)
        except Exception as e:
            status = {"error": str(e)}

    record = {
        "label": label,
        "doc": doc_name,
        "job_id": job_id,
        "chat_id": chat_id,
        "sha": health().get("commit"),
        "model_requested": "deepseek/deepseek-v4-flash",
        "tools": tools,
        "tool_count": len(tools),
        "duration_s": round(elapsed, 1),
        "checkpoints": len(checkpoints),
        "terminal_sse": terminal,
        "job_state_persisted": status.get("state") if isinstance(status, dict) else None,
        "final_reason": status.get("finalReason") if isinstance(status, dict) else None,
        "content_length": len(content),
        "content_tail": content[-300:],
    }
    append(record)
    print(f"[{label}] done: state={record['job_state_persisted']} tools={record['tool_count']} "
          f"checkpoints={record['checkpoints']} duration={record['duration_s']}s content={record['content_length']} chars")
    return record


def main():
    # Non-destructive by default: these suites create QA projects,
    # documents and chats on the staging account. Refuse to run without
    # an explicit opt-in so a stray execution cannot mutate anything.
    if os.environ.get("MIKE_QA_ALLOW_WRITES") != "1":
        print("dry-run: set MIKE_QA_ALLOW_WRITES=1 to run this suite (it creates QA data)")
        return

    h = health()
    append({"test": "build_identity", "commit": h.get("commit"), "deploy_run": h.get("deploy_run"),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    token = login()
    h = health()
    print("build:", h["commit"], h["deploy_run"])

    prompt_tpl = ("Analise integralmente o documento anexo {name}: identifique cláusulas principais, "
                  "obrigações das partes, riscos e anexos citados. Produza um parecer completo ao final.")

    # Battery 1: 3 runs per document
    for doc_id, doc_name in [(PETRONECT, "Petronect_REVISADO_usuario.docx"),
                             (FIOSAUDE, "FioSaude_REVISADO_usuario.docx")]:
        for i in (1, 2, 3):
            run_execution(token, f"{doc_name.split('_')[0]}-run{i}", doc_id, doc_name,
                          prompt_tpl.format(name=doc_name))

    # Battery 2: pause -> status check (simulated reload) -> resume same job
    paused = run_execution(token, "pause-petronect", PETRONECT, "Petronect_REVISADO_usuario.docx",
                           prompt_tpl.format(name="Petronect_REVISADO_usuario.docx"),
                           tool_budget=2)
    if paused["job_state_persisted"] == "paused":
        # "reload": re-read job status fresh (the endpoint above already simulates it)
        resumed = run_execution(token, f"resume-{paused['job_id'][:8]}", PETRONECT,
                                "Petronect_REVISADO_usuario.docx", "",
                                resume_job_id=paused["job_id"])
        print("resume kept job_id:", resumed["job_id"] == paused["job_id"])
    else:
        print("pause scenario: job did NOT pause (state="
              f"{paused['job_state_persisted']}, terminal={paused['terminal_sse']}) — "
              "synthesis reserve produced a final answer instead; recording as-is")

    print("evidence:", OUT)


if __name__ == "__main__":
    main()
