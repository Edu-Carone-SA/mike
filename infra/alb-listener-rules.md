# ALB Listener Rules — HTTPS (Port 443)

> **Status**: Manual rules applied via AWS CLI. Terraform sync pending (Sprint 6).
> **Last updated**: 2026-07-13

## Architecture

The Mike staging ALB (`atlas-mike-staging-alb`) uses path-pattern routing to send
requests to three target groups:

| Target Group | Name | Port | Service |
|---|---|---|---|
| `atlas-mike-stg-fe` | Frontend | 3000 | Next.js (production mode) |
| `atlas-mike-stg-be` | Backend | 3001 | Express API |
| `atlas-mike-stg-sup` | Supabase | 8000 | Kong (GoTrue + PostgREST) |

## The Problem: Shared Path Namespace

Frontend (Next.js) and backend (Express) share the same paths:
- `/projects` — Next.js page (HTML) **and** Express API (JSON)
- `/workflows` — Next.js page (HTML) **and** Express API (JSON)
- `/projects/[id]` — Next.js page **and** Express API
- `/workflows/[id]` — Next.js page **and** Express API

Without differentiation, the ALB sends everything to the backend, returning
401 JSON instead of the HTML page when a user navigates directly.

## Solution: Header-Based Routing

Rules with higher priority (11-14) intercept browser navigation requests
(`Accept: text/html`) and send them to the frontend. API calls
(`Accept: application/json`) fall through to the existing backend rules.

This works because:
- **Browser navigation** sends `Accept: text/html,application/xhtml+xml,...`
- **API calls** (`apiRequest()` in `mikeApi.ts`) send `Accept: application/json`
- The ALB `http-header` condition supports wildcard matching (`*text/html*`)

## Current Rules (HTTPS Listener, Port 443)

| Priority | Path Pattern | Header Condition | Target |
|---|---|---|---|
| 10 | `/supabase/*` | — | Supabase (Kong) |
| **11** | **`/projects`** | **Accept: `*text/html*`** | **Frontend** |
| **12** | **`/projects/*`** | **Accept: `*text/html*`** | **Frontend** |
| **13** | **`/workflows`** | **Accept: `*text/html*`** | **Frontend** |
| **14** | **`/workflows/*`** | **Accept: `*text/html*`** | **Frontend** |
| 15 | `/chat`, `/projects`, `/single-documents` (exact) | — | Backend |
| 20 | `/health`, `/ready`, `/chat/*`, `/projects/*`, `/single-documents/*` | — | Backend |
| 25 | `/tabular-review`, `/workflows`, `/user`, `/users`, `/download` (exact) | — | Backend |
| 30 | `/tabular-review/*`, `/workflows/*`, `/user/*`, `/users/*`, `/download/*` | — | Backend |
| 35 | `/case-law` (exact) | — | Backend |
| 40 | `/case-law/*` | — | Backend |
| 45 | `/admin` (exact) | — | Backend |
| 46 | `/admin/*` | — | Backend |
| default | everything else | — | Frontend |

## Verification

```bash
# Browser navigation → should return HTML 200
curl -s -o /dev/null -w "%{http_code} %{content_type}" -H "Accept: text/html" https://mike.agov.app/projects
# Expected: 200 text/html

# API call → should return JSON 401 (without auth token)
curl -s -o /dev/null -w "%{http_code} %{content_type}" -H "Accept: application/json" https://mike.agov.app/projects
# Expected: 401 application/json
```

## Future Improvement

The permanent solution is to move all backend API routes under the `/api/*`
prefix (e.g., `NEXT_PUBLIC_API_BASE_URL=https://mike.agov.app/api`). This
eliminates the path conflict entirely and removes the need for header-based
routing. This is planned for a future sprint.

## How to Apply Rules Manually

```bash
LISTENER_ARN="arn:aws:elasticloadbalancing:us-east-1:136770599935:listener/app/atlas-mike-staging-alb/4006dd3373817ddb/dcc40bea734901a5"
FE_TG_ARN="arn:aws:elasticloadbalancing:us-east-1:136770599935:targetgroup/atlas-mike-stg-fe/e05bddff01b286eb"

aws elbv2 create-rule \
  --region us-east-1 \
  --listener-arn "$LISTENER_ARN" \
  --priority 11 \
  --conditions '[
    {"Field":"path-pattern","Values":["/projects"]},
    {"Field":"http-header","HttpHeaderConfig":{"HttpHeaderName":"Accept","Values":["*text/html*"]}}
  ]' \
  --actions '[{"Type":"forward","TargetGroupArn":"'"$FE_TG_ARN"'"}]'
```
