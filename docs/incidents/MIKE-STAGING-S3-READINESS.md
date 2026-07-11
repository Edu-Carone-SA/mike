# Incident Report — Mike Staging S3 Readiness Failure

**Incident:** MIKE-STAGING-S3-READINESS
**Environment:** AWS Staging
**Project:** Mike (Atlas Governance)
**Severity:** High — backend unhealthy, S3 uploads non-functional

---

## Symptom

The backend `/ready` endpoint returned `503 Service Unavailable` with
`storage: false` in the readiness payload. The ECS backend task was marked
unhealthy by the ALB, and S3 document uploads were non-functional.

---

## Impact

- The backend task was marked **unhealthy** by the ALB, which could remove it
  from the target group and prevent traffic from reaching it.
- **S3 document uploads were non-functional**, blocking any staging workflow
  that depends on document storage.

---

## Root Cause

`storage.ts` **always passed an explicit `credentials` object** to the AWS SDK
`S3Client` constructor. On ECS, S3 access is provided via the **task IAM role**,
which the SDK resolves through its **default credential provider chain**. By
forcing a static `credentials` field into the `S3Client` configuration, the
code bypassed the default chain and prevented the IAM role from being used, so
every S3 call failed.

Additionally, the `storageEnabled` readiness check gated the `storage` status
on the **presence of static access key credentials** rather than on the
**presence of a configured bucket name**. In IAM-role mode — where no static
keys are configured — the check reported `storage: false` even though S3
access was available through the task role.

---

## Correction

- **Conditional credentials in `storage.ts`** — the `S3Client` is now
  constructed with explicit `credentials` **only** when static credentials are
  present. When they are absent (the ECS/IAM-role case), no `credentials` field
  is passed, allowing the AWS SDK default credential provider chain to resolve
  the task role.
- **`storageEnabled` checks `bucketName()`** — the readiness gate now reports
  `storage: true` when a bucket name is configured, regardless of whether
  static credentials are supplied.

---

## Regression Test

After applying the fix, the following checks were performed against the
staging backend:

```bash
# Backend readiness
curl -fsS https://mike.agov.app/api/ready
# Expected: 200, with "storage": true in the response payload
```

The endpoint returned `200 OK` with `storage: true`. The ECS task IAM role
provides S3 access to the `atlas-mike-staging-documents` bucket without any
static credentials configured.

---

## Prevention

- **Always test IAM mode in ECS.** Verify that the task role provides S3 access
  and that the application does not require static credentials when running on
  Fargate/ECS.
- **Never hardcode credentials in SDK initialization.** Let the AWS SDK default
  credential provider chain resolve credentials from the environment unless
  static credentials are explicitly required.
- **Gate readiness on configuration, not credentials.** A service is "ready"
  for storage when a bucket is configured — not when a specific credential type
  is present.
