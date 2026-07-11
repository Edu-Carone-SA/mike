# Mike AWS Staging — Smoke Test Runbook

**Environment:** AWS Staging
**Project:** Mike (Atlas Governance)
**Base URL:** `https://mike.agov.app`

This runbook defines the standard smoke test performed after a staging
deployment or infrastructure change. All steps must pass before staging is
considered healthy.

---

## Prerequisites

- **AWS CLI** configured with access to the `atlas-mike-staging` account.
- **Anonymous (anon) key** available for unauthenticated API calls — obtain
  from the staging app secrets; never commit it to the repo.
- **Staging user credentials** — `mike-admin@atlasgov.com` and its current
  password (delivered separately; never stored in this document).
- `curl` and `jq` installed locally.

Set the following environment variables before running the steps:

```bash
export STAGING_URL="https://mike.agov.app"
export ANON_KEY="<anon key — obtain from secrets, do not commit>"
export STAGING_USER="mike-admin@atlasgov.com"
export STAGING_PASSWORD="<password — delivered separately, do not commit>"
```

---

## Steps

### 1. Frontend health

**Command:**

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" "$STAGING_URL/api/health"
```

**Expected:** `200`

---

### 2. Backend health

**Command:**

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" "$STAGING_URL/api/healthz"
```

**Expected:** `200`

> Use the backend health path configured on the ALB target group. If the
> backend exposes `/health` instead, substitute accordingly.

---

### 3. Backend readiness

**Command:**

```bash
curl -fsS "$STAGING_URL/api/ready" | jq .
```

**Expected:** `200`, with a JSON payload containing `"storage": true`.

---

### 4. Auth health

**Command:**

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" \
  "$STAGING_URL/auth/v1/health"
```

**Expected:** `200`

---

### 5. Anonymous protected route returns 401

**Command:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: $ANON_KEY" \
  "$STAGING_URL/api/documents"
```

**Expected:** `401`

> An anonymous request (anon key only, no user token) to a protected route
> must be rejected.

---

### 6. Invalid token returns 401

**Command:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer not-a-real-token" \
  "$STAGING_URL/api/documents"
```

**Expected:** `401`

---

### 7. Valid login

**Command:**

```bash
LOGIN_RESP=$(curl -fsS \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$STAGING_USER\",\"password\":\"$STAGING_PASSWORD\"}" \
  "$STAGING_URL/auth/v1/token?grant_type=password")

echo "$LOGIN_RESP" | jq -r '.access_token' | head -c 20
echo "..."
echo "$LOGIN_RESP" | jq -r '.user.email'
```

**Expected:** A truncated access token is printed and the user email
`mike-admin@atlasgov.com` is returned.

---

### 8. CORS — allowed origin

**Command:**

```bash
curl -s -i -X OPTIONS \
  -H "Origin: https://mike.agov.app" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: apikey,authorization,content-type" \
  "$STAGING_URL/api/documents" \
  | grep -i "access-control-allow-origin"
```

**Expected:** A header line such as
`access-control-allow-origin: https://mike.agov.app` (or `*` if the backend
reflects the origin).

---

### 9. CORS — foreign origin

**Command:**

```bash
curl -s -i -X OPTIONS \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: apikey,authorization,content-type" \
  "$STAGING_URL/api/documents" \
  | grep -i "access-control-allow-origin" || echo "NO ACAO HEADER (correct)"
```

**Expected:** `NO ACAO HEADER (correct)` — no `Access-Control-Allow-Origin`
header is returned for a foreign origin.

---

### 10. Old password rejected

**Command:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$STAGING_USER\",\"password\":\"old-or-rotated-password\"}" \
  "$STAGING_URL/auth/v1/token?grant_type=password"
```

**Expected:** `400` or `401` — the previously rotated password must no longer
authenticate.

---

## Summary

All ten steps must pass. If any step fails, do not approve the staging
deployment; investigate and re-run the full smoke test after a fix.
