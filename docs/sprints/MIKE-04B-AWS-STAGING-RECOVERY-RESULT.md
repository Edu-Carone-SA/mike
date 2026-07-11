# MIKE-04B — AWS Staging Recovery — Sprint Result

**Sprint:** MIKE-04B-AWS-STAGING-RECOVERY
**Branch:** `sprint/MIKE-04B-AWS-STAGING-RECOVERY`
**Project:** Mike (Atlas Governance)
**Status:** ✅ All green

---

## Sprint Objective

Recover the Mike AWS staging environment, restoring frontend availability and
achieving S3 storage readiness so that the staging stack is fully functional
end-to-end (frontend, backend, auth, and document storage).

---

## Bug 1 — Frontend 502/503 on all routes

### Symptom

All frontend routes on the staging ALB returned `502 Bad Gateway` or
`503 Service Unavailable`. The ECS frontend task cycled between starting and
unhealthy, never reaching a steady running state.

### Root cause

Multiple compounding issues caused the Next.js frontend to fail its health
checks and never serve production traffic:

1. **`NODE_ENV=development` in the task definition** — the container ran Next.js
   in dev mode (`next dev`), which is single-threaded, slow to boot, and not
   intended for ECS/Fargate.
2. **Dev-mode base image** — the Dockerfile did not distinguish between a
   development and a production image; the same image that runs locally was
   shipped to ECS.
3. **Health check target mismatch** — the ALB health check pointed at `/`
   (a full SSR page render) instead of the lightweight `/api/health` endpoint.
   SSR page renders in dev mode exceeded the health-check grace period, so the
   target was marked unhealthy before it could respond.
4. **`NEXT_PUBLIC_*` variables treated as runtime secrets** — Next.js requires
   `NEXT_PUBLIC_*` variables at **build time** so they are inlined into the
   client bundle. They were instead injected at runtime as container
   environment secrets, which means the compiled bundle never saw them.
5. **`postcss.config.mjs` missing from the Docker context** — the file was not
   copied into the image, so Tailwind/PostCSS processing failed during the
   production build, producing a broken CSS pipeline.
6. **`tw-animate-css` in `devDependencies`** — the package was only available
   in dev mode; the production `npm ci --omit=dev` install stripped it out, and
   the build failed on import.

---

## Bug 2 — Backend `/ready` returns 503 (`storage:false`)

### Symptom

The backend `/ready` endpoint returned `503` with `storage: false` in the
readiness payload. The backend task was marked unhealthy by the ALB and S3
document uploads were non-functional.

### Root cause

1. **`storage.ts` forced static credentials into `S3Client`** — the code always
   passed an explicit `credentials` object to the AWS SDK `S3Client`
   constructor. When running on ECS with a task role, this bypassed the SDK's
   default credential provider chain and prevented the IAM role from being
   used, so every S3 call failed.
2. **`storageEnabled` required static credentials** — the readiness check gated
   `storage` on the presence of static access key credentials rather than on
   the presence of a configured bucket name. In IAM-role mode (no static keys),
   the check reported `false` even though S3 access was available via the task
   role.

---

## Fixes Applied

### Frontend

- **`Dockerfile.prod` with build args** — a dedicated production Dockerfile that
  runs `next build` and `next start`, receiving `NEXT_PUBLIC_*` values as
  build-time `ARG`s so they are baked into the bundle.
- **`postcss.config.mjs` COPY** — the file is now explicitly copied into the
  Docker build context before the build step.
- **`tw-animate-css` moved to `dependencies`** — the package now survives
  `npm ci --omit=dev` and is available at production build time.
- **Task definition updated to production mode** — `NODE_ENV=production`, ARM64
  architecture, and the ALB health check retargeted to `/api/health`.
- **`/api/health` endpoint** — lightweight health endpoint used by the ALB and
  ECS health checks, decoupled from SSR page renders.

### Backend

- **`storage.ts` conditional credentials** — the `S3Client` is now constructed
  with explicit credentials **only** when static credentials are present. When
  they are absent (the ECS/IAM-role case), no `credentials` field is passed,
  allowing the SDK default credential provider chain to resolve the task role.
- **`storageEnabled` checks `bucketName()`** — the readiness gate now reports
  `storage: true` when a bucket name is configured, regardless of whether
  static credentials are supplied.
- **Task definition updated** — ARM64 architecture, production mode.

### Task definitions

Both frontend and backend task definitions were revised to:

- Run in production mode (`NODE_ENV=production`).
- Target the `ARM64` CPU architecture.
- Use the revised health-check paths and grace periods.

---

## Evidence

| Check | Result |
| --- | --- |
| Frontend `/api/health` | `200 OK` |
| Frontend `/` | `200 OK` |
| Frontend `/login` | `200 OK` |
| Backend `/health` | `200 OK` |
| Backend `/ready` | `200 OK` with `storage: true` |
| Auth health | `200 OK` |
| Login (valid credentials) | Functional, session issued |
| CORS (allowed origin) | `Access-Control-Allow-Origin` present |
| CORS (foreign origin) | No `Access-Control-Allow-Origin` header |

All health checks return `200`; login is functional; CORS headers are correct
for allowed origins and absent for foreign origins.

---

## DNS and TLS

- **DNS:** `mike.agov.app` is a `CNAME` record pointing to the staging ALB.
- **ACM certificate:** issued for `mike.agov.app` and attached to the HTTPS
  listener on the ALB.
- **HTTPS listener:** terminates TLS on the ALB; the HTTP listener redirects
  to HTTPS.

---

## Status

✅ **All green.** Frontend, backend, auth, and S3 storage are healthy and
functional on AWS staging. The sprint objectives — recovering the frontend and
achieving S3 readiness — are complete.
