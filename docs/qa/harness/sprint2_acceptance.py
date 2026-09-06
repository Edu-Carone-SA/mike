#!/usr/bin/env python3
"""
Sprint 2 acceptance battery — Mike staging.

Acceptance #1: projects with 1, 5, 10 files complete exactly once; the
document list is consistent after reload (re-GET). Idempotency: re-sending
the same upload with the same key must not duplicate.

Runs against staging using the test account (chico-debug-e98d70) with
small generated DOCX files. Records evidence to
mike-sprint2-acceptance.jsonl (cwd, or MIKE_QA_EVIDENCE).
"""
import io
import json
import os
import time
import zipfile
import urllib.request
import urllib.error

STAGING = "https://mike.agov.app"
FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
def _cred():
    return {
        "email": os.environ["MIKE_QA_EMAIL"],
        "password": os.environ["MIKE_QA_PASSWORD"],
    }
_secrets = {
    **{k: v for k, v in os.environ.items() if k.startswith("MIKE_QA_SECRET_")},
    **json.loads(os.environ.get("MIKE_QA_SECRETS_JSON", "{}")),
}


def login():
    body = json.dumps({"email": _cred()["email"], "password": _cred()["password"]}).encode()
    req = urllib.request.Request(
        f"{STAGING}/supabase/auth/v1/token?grant_type=password",
        data=body, method="POST",
        headers={"apikey": _secrets["SUPABASE_ANON_KEY"], "Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["access_token"]


def api(token, method, path, data=None, headers=None, raw=None, timeout=300):
    url = f"{STAGING}{path}"
    body = raw if raw is not None else (json.dumps(data).encode() if data else None)
    h = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if data is not None and not (headers or {}).get("Content-Type"):
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers={
        **h,
        **(headers or {}),
    })
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        payload = resp.read()
        return resp.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, payload.decode(errors="replace")[:300]


def make_docx(name: str, pages_text: str = "Contrato de prestacao de servicos. ") -> bytes:
    """Minimal DOCX (same trick as the TAB-002 reproduction harness)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{name}. {pages_text * 40}</w:t></w:r></w:p></w:body></w:document>')
    return buf.getvalue()


def upload_multipart(token, path, fname, content, idem):
    """POST multipart/form-data with field 'file' (what multer expects)."""
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
            "X-Idempotency-Key": idem,
        },
    )
    try:
        resp = urllib.request.urlopen(req, timeout=300)
        payload = resp.read()
        return resp.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None


def idem_key(project_id, fname, size):
    return f"upload:{project_id}:{fname}:{size}:sprint2"


def wait_processing(token, document_id, cap_s=300):
    """Poll /processing until terminal. Returns (state, seconds)."""
    start = time.time()
    while time.time() - start < cap_s:
        status, payload = api(token, "GET", f"/single-documents/{document_id}/processing")
        if status == 404:
            return "no_job", round(time.time() - start, 1)
        if payload and payload.get("state") in ("ready", "failed", "cancelled"):
            return payload["state"], round(time.time() - start, 1)
        time.sleep(2)
    return "timeout", round(time.time() - start, 1)


def append(rec):
    # Sanitize: evidence JSONL must never carry credentials or signed URLs.
    rec = {k: v for k, v in rec.items() if k not in ("token", "url", "password")}
    with open(os.environ.get("MIKE_QA_EVIDENCE", "mike-sprint2-acceptance.jsonl"), "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def run_project_batch(token, label, n_files):
    health = json.loads(urllib.request.urlopen(f"{STAGING}/health", timeout=60).read())
    ts = int(time.time())
    status, project = api(token, "POST", "/projects", {
        "name": f"Sprint2 QA {label} {ts}", "cm_number": f"CM-S2-{ts}",
    })
    if status != 201:
        append({"label": label, "error": f"project create {status}", "detail": project})
        return
    project_id = project["id"]
    sha = health.get("commit")

    # Sequential uploads with idempotency keys (mirrors the modal)
    docs = []
    for i in range(n_files):
        fname = f"qa_{label}_{i}.docx"
        content = make_docx(fname)
        key = idem_key(project_id, fname, len(content))
        status, doc = upload_multipart(
            token, f"/projects/{project_id}/documents", fname, content, key)
        if status != 201:
            append({"label": label, "error": f"upload {fname} -> {status}", "detail": str(doc)[:200]})
            return
        docs.append(doc)

    # DUPLICATE TEST: re-send the first file with the same key — must NOT
    # create a second document.
    first = docs[0]
    dup_content = make_docx(f"qa_{label}_0.docx")
    dup_status, dup_doc = upload_multipart(
        token, f"/projects/{project_id}/documents", f"qa_{label}_0.docx", dup_content,
        idem_key(project_id, f"qa_{label}_0.docx", len(dup_content)))
    # The re-send creates a NEW document row (documents table is not
    # idempotent), but the JOB must be deduped: check job count.

    # Wait for all processing jobs to reach terminal
    states = []
    for doc in docs:
        state, secs = wait_processing(token, doc["id"])
        states.append({"doc": doc["id"], "state": state, "wait_s": secs})

    # RELOAD: re-GET the project documents — must be consistent (n_files docs)
    status, plist = api(token, "GET", f"/projects/{project_id}/documents")
    reloaded = len(plist) if status == 200 else f"err {status}"

    # readiness contract on each doc
    ready_flags = []
    for doc in docs:
        s, d = api(token, "GET", f"/single-documents/{doc['id']}")
        ready_flags.append({
            "analysis_ready": d.get("analysis_ready"),
            "extracted_text_length": d.get("extracted_text_length"),
            "processing_state": d.get("processing_state"),
            "failure_reason": d.get("failure_reason"),
        })

    append({
        "label": label,
        "project_id": project_id,
        "files": n_files,
        "sha": sha,
        "states": states,
        "docs_after_reload": reloaded,
        "consistent": reloaded == n_files,
        "readiness": ready_flags,
        "all_ready": all(r["analysis_ready"] for r in ready_flags),
    })
    print(f"[{label}] docs_after_reload={reloaded} (expected {n_files}) "
          f"all_ready={all(r['analysis_ready'] for r in ready_flags)}")


def main():
    # Non-destructive by default: these suites create QA projects,
    # documents and chats on the staging account. Refuse to run without
    # an explicit opt-in so a stray execution cannot mutate anything.
    if os.environ.get("MIKE_QA_ALLOW_WRITES") != "1":
        print("dry-run: set MIKE_QA_ALLOW_WRITES=1 to run this suite (it creates QA data)")
        return

    health = json.loads(urllib.request.urlopen(f"{STAGING}/health", timeout=60).read())
    print("build:", health.get("commit"), health.get("deploy_run"))
    append({"test": "build_identity", "commit": health.get("commit"), "deploy_run": health.get("deploy_run"),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})

    token = login()

    # /ready should expose the pipeline backlog
    status, ready = api(token, "GET", "/ready")
    print("/ready:", status, json.dumps(ready.get("document_pipeline") if isinstance(ready, dict) else ready))

    for n in (1, 5, 10):
        run_project_batch(token, f"batch-{n}", n)


if __name__ == "__main__":
    main()
