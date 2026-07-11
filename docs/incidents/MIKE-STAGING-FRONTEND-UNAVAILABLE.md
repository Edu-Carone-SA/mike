# Incident Report — Mike Staging Frontend Unavailable

**Incident:** MIKE-STAGING-FRONTEND-UNAVAILABLE
**Environment:** AWS Staging
**Project:** Mike (Atlas Governance)
**Severity:** High — staging completely unavailable

---

## Symptom

All frontend routes on the Mike staging environment returned `502 Bad Gateway`
or `503 Service Unavailable`. The ECS frontend task repeatedly failed its ALB
health check and cycled between `STARTING` and `UNHEALTHY`, never reaching a
steady running state.

---

## Impact

The Mike staging environment was **completely unavailable**. No frontend page
could be loaded, which blocked all staging validation, QA, and downstream
integration testing.

---

## Root Cause

The frontend container ran **Next.js in development mode** inside ECS. This was
caused by a combination of factors:

1. **`NODE_ENV=development`** was set in the ECS task definition, so the
   container ran `next dev` instead of `next start`. Dev mode is
   single-threaded, slow to boot, and not designed for ECS/Fargate.
2. **ALB health check targeted `/`** — a full server-side rendered page —
   instead of a lightweight health endpoint. In dev mode, SSR page compilation
   and render exceeded the health-check grace period, so the target was marked
   unhealthy before it could respond.
3. **`postcss.config.mjs` was missing from the Docker build context**, which
   broke the Tailwind/PostCSS pipeline during the production build and produced
   a broken CSS bundle.

---

## Correction

- Introduced a dedicated **production Dockerfile** (`Dockerfile.prod`) that runs
  `next build` and `next start` with `NODE_ENV=production`.
- Added a lightweight **`/api/health` endpoint** and retargeted the ALB and ECS
  health checks to it, decoupling health status from SSR page renders.
- Set a **`startPeriod` of 60 seconds** on the container health check to allow
  the production server to finish booting before being evaluated.
- Explicitly copied **`postcss.config.mjs`** into the Docker build context.
- Updated the ECS task definition to production mode on **ARM64**.

---

## Regression Test

After applying the fix, the following checks were performed against the
staging ALB:

```bash
# Health endpoint
curl -fsS -o /dev/null -w "%{http_code}\n" https://mike.agov.app/api/health
# Expected: 200

# Root page
curl -fsS -o /dev/null -w "%{http_code}\n" https://mike.agov.app/
# Expected: 200

# Login page
curl -fsS -o /dev/null -w "%{http_code}\n" https://mike.agov.app/login
# Expected: 200
```

All three returned `200 OK`.

---

## Prevention

- **Never use `next dev` in ECS.** Always build and run the production server
  (`next build` + `next start`) via a production Dockerfile.
- **Always copy `postcss.config.mjs`** (and any other build-time config files)
  into the Docker build context.
- **Always use the production Dockerfile** for ECS deployments; do not ship the
  local development image.
- Prefer a dedicated health endpoint (`/api/health`) for ALB/ECS health checks
  rather than full SSR page renders.
- Set an adequate `startPeriod` on container health checks to absorb startup
  latency.
