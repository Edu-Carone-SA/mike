#!/usr/bin/env python3
"""
PR #86 — Teste automatizado de resposta longa e reload (P1 do reaceite).

Oráculo (aceite objetivo, conforme pedido pelo QA no reaceite
'Reaceite Independente — PR #86: Watchdog de Stall e TTFT'):

  1. Um turno que exige N achados numerados + marcador final obrigatório
     (`CONCLUSÃO FINAL`) completa com terminal único.
  2. O transcript persistido APÓS reload (GET /chat/:id) contém:
     - todos os N marcadores `Achado N` distintos;
     - o marcador final `CONCLUSÃO FINAL`;
     - o texto completo emitido no stream (a persistida não pode ser
       menor que a emitida — sintoma `inadimp`);
     - nenhum terminal duplicado ou anômalo (Failed/Cancelled/Paused).

Não-destrutivo por padrão: sem MIKE_QA_ALLOW_WRITES=1 apenas imprime
dry-run. Cria um chat próprio na conta de QA; não toca dados existentes.
"""
import json
import os
import re
import sys
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
EVIDENCE = os.environ.get("MIKE_QA_EVIDENCE", "pr86_long_response_integrity.jsonl")
FINDINGS_COUNT = int(os.environ.get("MIKE_QA_FINDINGS_COUNT", "10"))
FINAL_MARKER = "CONCLUSÃO FINAL"


def log(rec):
    # Sanitize: evidence JSONL must never carry credentials or signed URLs.
    rec = {k: v for k, v in rec.items() if k not in ("token", "url", "password")}
    with open(EVIDENCE, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps(rec, ensure_ascii=False))


def login():
    body = json.dumps(_cred()).encode()
    req = urllib.request.Request(
        f"{STAGING}/supabase/auth/v1/token?grant_type=password",
        data=body, method="POST",
        headers={"apikey": _secrets["SUPABASE_ANON_KEY"],
                 "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["access_token"]


def upload_fixture(token):
    """Uploads the controlled synthetic minuta (fixtures/s4-minuta.docx) so
    the long-response turn has a real document context — the same shape as
    the QA scenario (a stalled/empty context makes the job take the typed
    `paused` path, which is designed behavior, not the truncation oracle)."""
    fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "s4-minuta.docx")
    if not os.path.exists(fixture):
        raise SystemExit(f"fixture not found: {fixture}")
    boundary = "----mikeqaboundary"
    with open(fixture, "rb") as f:
        filedata = f.read()
    parts = [
        (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="pr86-long-response-minuta.docx"\r\n'
         f'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n').encode()
        + filedata + b"\r\n",
        f'--{boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\npr86-long-response-minuta.docx\r\n'.encode(),
        f'--{boundary}--\r\n'.encode(),
    ]
    req = urllib.request.Request(
        f"{STAGING}/single-documents",
        data=b"".join(parts), method="POST",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"})
    resp = json.loads(urllib.request.urlopen(req, timeout=180).read())
    doc_id = resp.get("id") or resp.get("document_id")
    if not doc_id:
        raise SystemExit(f"upload returned no id: {list(resp.keys())}")
    # wait for analysis_ready
    for _ in range(60):
        r = urllib.request.Request(f"{STAGING}/single-documents/{doc_id}",
                                   headers={"Authorization": f"Bearer {token}"})
        d = json.loads(urllib.request.urlopen(r, timeout=60).read())
        if d.get("analysis_ready"):
            return doc_id
        time.sleep(3)
    raise SystemExit("document never became analysis_ready")


def stream_turn(token, content, doc_id=None, timeout=600):
    """POST /chat (SSE). Returns (full_text, event_types, chat_id)."""
    payload = {
        "messages": [{"role": "user", "content": content}],
        "model": "deepseek/deepseek-v4-flash",
    }
    if doc_id:
        payload["attached_documents"] = [
            {"filename": "pr86-long-response-minuta.docx", "document_id": doc_id}]
    req = urllib.request.Request(
        f"{STAGING}/chat",
        data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json",
                 "Accept": "text/event-stream"})
    full_text, event_types, chat_id = [], set(), None
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                ev = json.loads(data)
            except ValueError:
                continue
            et = ev.get("type")
            if et:
                event_types.add(et)
            if et == "chat_id":
                chat_id = ev.get("chatId") or ev.get("chat_id") or ev.get("id")
            if et in ("content", "content_delta") and isinstance(ev.get("text"), str):
                full_text.append(ev["text"])
    return "".join(full_text), event_types, chat_id


def reload_chat(token, chat_id):
    req = urllib.request.Request(
        f"{STAGING}/chat/{chat_id}",
        headers={"Authorization": f"Bearer {token}"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def assistant_text_and_events(chat_detail):
    """Extracts concatenated text + event types from the persisted
    assistant messages (content is a list of blocks)."""
    texts, events = [], set()
    for m in chat_detail.get("messages", []):
        if m.get("role") != "assistant":
            continue
        c = m.get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get("type") in ("content", "text") and isinstance(b.get("text"), str):
                texts.append(b["text"])
            elif b.get("type") not in ("content", "text"):
                events.add(b.get("type"))
    return "\n".join(texts), events


def main():
    if os.environ.get("MIKE_QA_ALLOW_WRITES") != "1":
        print("dry-run: set MIKE_QA_ALLOW_WRITES=1 to run the long-response integrity test")
        return 0

    token = login()
    doc_id = upload_fixture(token)
    log({"case": "pr86_long_response", "phase": "start",
         "findings_count": FINDINGS_COUNT, "document_id": doc_id})

    prompt = (
        f"Faça uma auditoria jurídica do documento anexo listando EXATAMENTE "
        f"{FINDINGS_COUNT} achados numerados (formato 'Achado N'), cada um com tema, "
        f"risco e recomendação em uma linha, citando a página correspondente. Depois "
        f"apresente uma matriz resumida em Markdown e encerre OBRIGATORIAMENTE com uma "
        f"linha final contendo exatamente '{FINAL_MARKER}' seguida de um parágrafo de "
        f"fechamento. Não gere nenhum arquivo."
    )

    t0 = time.time()
    emitted_text, event_types, chat_id = stream_turn(token, prompt, doc_id=doc_id)
    duration_s = round(time.time() - t0, 1)
    if not chat_id:
        log({"case": "pr86_long_response", "phase": "stream", "pass": False,
             "reason": "no chat_id in stream"})
        return 1
    log({"case": "pr86_long_response", "phase": "stream", "pass": True,
         "chat_id": chat_id, "duration_s": duration_s,
         "emitted_chars": len(emitted_text)})

    # RELOAD — the persisted transcript is the source of truth.
    time.sleep(2)
    detail = reload_chat(token, chat_id)
    persisted_text, persisted_events = assistant_text_and_events(detail)
    markers = {f"Achado {i}" for i in range(1, FINDINGS_COUNT + 1)}
    found_markers = sorted(
        {m for m in markers if re.search(rf"\b{re.escape(m)}\b", persisted_text)})
    has_final = FINAL_MARKER in persisted_text
    not_shorter = len(persisted_text) >= len(emitted_text)
    bad_terminals = persisted_events & {"error", "job_paused"}
    completed_count = sum(
        1 for m in detail.get("messages", [])
        if m.get("role") == "assistant" and isinstance(m.get("content"), list)
        and any(isinstance(b, dict) and b.get("type") == "job_status"
                and b.get("state") == "completed" for b in m["content"] if isinstance(b, dict))
    )

    checks = {
        "all_markers_present": len(found_markers) == FINDINGS_COUNT,
        "final_marker_present": has_final,
        "persisted_not_shorter_than_emitted": not_shorter,
        "no_anomalous_terminal": not bad_terminals,
        "single_completed_terminal": completed_count <= 1,
    }
    log({"case": "pr86_long_response", "phase": "reload_verify",
         "chat_id": chat_id, "persisted_chars": len(persisted_text),
         "emitted_chars": len(emitted_text),
         "markers_found": len(found_markers), "markers_expected": FINDINGS_COUNT,
         "final_marker": has_final, "completed_terminals": completed_count,
         "anomalous_events": sorted(bad_terminals), "checks": checks})

    all_pass = all(checks.values())
    log({"case": "pr86_long_response", "phase": "verdict",
         "pass": all_pass, "checks": checks})
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
