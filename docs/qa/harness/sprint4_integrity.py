#!/usr/bin/env python3
"""
Sprint 4 acceptance — criteria 1 & 2 (draft integrity via edit_document).

C1: controlled minuta preserves clauses/annexes after an AUTHORIZED edit.
C2: a destructive edit (removing an annex paragraph) is BLOCKED with a
    readable technical error; no navigable artifact is created.
"""
import hashlib
import json
import os
import re
import time
import urllib.request
import urllib.error

def _cred():
    return {
        "email": os.environ["MIKE_QA_EMAIL"],
        "password": os.environ["MIKE_QA_PASSWORD"],
    }
_secrets = {
    **{k: v for k, v in os.environ.items() if k.startswith("MIKE_QA_SECRET_")},
    **json.loads(os.environ.get("MIKE_QA_SECRETS_JSON", "{}")),
}
STAGING = "https://mike.agov.app"
EVIDENCE = os.environ.get("MIKE_QA_EVIDENCE", "mike-sprint4-acceptance.jsonl")


def log(rec):
    # Sanitize: evidence JSONL must never carry credentials or signed URLs.
    rec = {k: v for k, v in rec.items() if k not in ("token", "url", "password")}
    with open(EVIDENCE, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps(rec, ensure_ascii=False))


def login():
    body = json.dumps({"email": _cred()["email"], "password": _cred()["password"]}).encode()
    req = urllib.request.Request(
        f"{STAGING}/supabase/auth/v1/token?grant_type=password",
        data=body, method="POST",
        headers={"apikey": _secrets["SUPABASE_ANON_KEY"],
                 "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["access_token"]


def api(token, method, path, data=None, timeout=300):
    url = f"{STAGING}{path}"
    h = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        p = r.read()
        return r.status, (json.loads(p) if p else None)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None


def upload_multipart(token, path, fname, content):
    boundary = "----mikeqa7d9f2b1c"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{fname}"\r\n'
        "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{STAGING}{path}", data=body, method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-Idempotency-Key": f"s4-{int(time.time()*1000)}",
        })
    try:
        r = urllib.request.urlopen(req, timeout=300)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None


def docx_paragraph_texts(blob):
    import zipfile
    z = zipfile.ZipFile(__import__("io").BytesIO(blob))
    xml = z.read("word/document.xml").decode()
    paras = re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)
    out = []
    for p in paras:
        ts = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p)
        t = "".join(ts).strip()
        if t:
            out.append(t)
    return out


def main():
    # Non-destructive by default: these suites create QA projects,
    # documents and chats on the staging account. Refuse to run without
    # an explicit opt-in so a stray execution cannot mutate anything.
    if os.environ.get("MIKE_QA_ALLOW_WRITES") != "1":
        print("dry-run: set MIKE_QA_ALLOW_WRITES=1 to run this suite (it creates QA data)")
        return
    _h = json.loads(urllib.request.urlopen(f"{STAGING}/health", timeout=60).read())
    log({"test": "build_identity", "commit": _h.get("commit"), "deploy_run": _h.get("deploy_run"),
         "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    token = login()
    sha = "e06fad766aeef5ce74dc3d9a43900dde979548e0"

    # --- upload the controlled minuta as a standalone document ----------
    # project-scoped upload (Sprint-1 battery pattern — chat attachments
    # resolve project documents)
    status, project = api(token, "POST", "/projects",
                          {"name": f"S4 Integrity {int(time.time())}"})
    if status not in (200, 201):
        log({"test": "c1_setup", "error": f"project {status}", "detail": str(project)[:150]})
        return
    project_id = project["id"]
    content = open(os.path.join(FIXTURES_DIR, "s4-minuta.docx"), "rb").read()
    status, doc = upload_multipart(token, f"/projects/{project_id}/documents",
                                   "minuta-controlada-s4.docx", content)
    if status not in (200, 201):
        log({"test": "c1_setup", "error": f"upload {status}", "detail": str(doc)[:200]})
        return
    doc_id = doc["id"]
    log({"test": "c1_setup", "ok": True, "project_id": project_id,
         "document_id": doc_id, "bytes": len(content)})

    def chat_run(label, prompt):
        payload = {
            "project_id": project_id,
            "messages": [{"role": "user", "content": prompt}],
            "attached_documents": [
                {"filename": "minuta-controlada-s4.docx", "document_id": doc_id}
            ],
            "model": "deepseek/deepseek-v4-flash",
        }
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{STAGING}/chat", data=body, method="POST", headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            })
        events = []
        text = ""
        with urllib.request.urlopen(req, timeout=900) as resp:
            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n\n" in buf:
                    raw, buf = buf.split(b"\n\n", 1)
                    for line in raw.decode(errors="replace").splitlines():
                        if line.startswith("data:"):
                            try:
                                events.append(json.loads(line[5:].strip()))
                            except Exception:
                                pass
        for e in events:
            if isinstance(e, dict) and e.get("type") == "delta":
                text += e.get("content", "")
        chat_id = next((e.get("chatId") for e in events
                        if isinstance(e, dict) and e.get("type") == "chat_id"), None)
        return chat_id, events, text

    # --- C2 FIRST: destructive edit — remove the annex II paragraph -----
    chat_id, events, text = chat_run(
        "c2",
        "O documento anexado tem o label doc-0. Use a ferramenta "
        "edit_document no doc-0 para excluir o parágrafo inteiro que começa "
        "com 'ANEXO II — POLÍTICA DE PRIVACIDADE' e também excluir o "
        "parágrafo seguinte 'A política de privacidade aplica-se a todas as "
        "partes.'. Não altere mais nada.")
    blocked = "draft-integrity" in text or "blocked" in text.lower()
    log({"test": "c2_destructive_edit",
         "ok": blocked, "chat_id": chat_id,
         "hint": text[:300].replace("\n", " ")})

    # verify no new version was created
    status, doc_now = api(token, "GET", f"/single-documents/{doc_id}")
    n_ver = doc_now.get("latest_version_number") if isinstance(doc_now, dict) else None
    log({"test": "c2_no_artifact", "ok": not n_ver or n_ver <= 1, "versions": n_ver})

    # --- C1: authorized edit — change the remuneration value ------------
    chat_id2, events2, text2 = chat_run(
        "c1",
        "Agora use edit_document no doc-0 para alterar apenas o valor "
        "'R$ 50.000,00' por 'R$ 65.000,00' na cláusula 2. Não altere mais nada.")
    log({"test": "c1_authorized_edit", "chat_id": chat_id2,
         "hint": text2[:200].replace("\n", " ")})

    # check versions + download + manifest preserved
    status, doc_now = api(token, "GET", f"/single-documents/{doc_id}")
    log({"test": "c1_versions", "count": doc_now.get("latest_version_number")})

    status, url_info = api(token, "GET", f"/single-documents/{doc_id}/url")
    req = urllib.request.Request(f"{STAGING}{url_info['url']}",
        headers={"Authorization": f"Bearer {token}"})
    blob = urllib.request.urlopen(req, timeout=120).read()
    paras = docx_paragraph_texts(blob)
    has_annex1 = any("ANEXO I" in p for p in paras)
    has_annex2 = any("ANEXO II" in p for p in paras)
    clauses = [p for p in paras if re.match(r"^\d+\.", p)]
    new_value = any("65.000" in p for p in paras)
    old_value = any("50.000" in p for p in paras)
    log({"test": "c1_manifest_preserved",
         "ok": has_annex1 and has_annex2 and len(clauses) == 4 and new_value,
         "annex1": has_annex1, "annex2": has_annex2,
         "clause_headings": len(clauses),
         "value_changed": new_value, "old_value_gone": not old_value,
         "sha256": hashlib.sha256(blob).hexdigest()[:16],
         "version_number": url_info.get("version_id", "")[:8]})

    log({"test": "battery_done", "sha": sha})


if __name__ == "__main__":
    main()
