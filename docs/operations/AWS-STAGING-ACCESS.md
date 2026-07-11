# Mike AWS Staging — Access Guide

**Environment:** AWS Staging
**Project:** Mike (Atlas Governance)

This document describes how to access and navigate the Mike staging
environment on AWS. It contains **no credentials** — secrets are stored in
AWS Secrets Manager and delivered out of band.

---

## Public URL

- **Base URL:** `https://mike.agov.app`
- HTTP requests are redirected to HTTPS.

---

## Application Load Balancer (ALB)

- **ALB native hostname:**
  `atlas-mike-staging-alb-1821218227.us-east-1.elb.amazonaws.com`
- **HTTPS listener:** terminates TLS using the ACM certificate for
  `mike.agov.app`.
- **HTTP listener:** redirects all requests to HTTPS.

---

## DNS

- `mike.agov.app` is a `CNAME` record pointing to the staging ALB.
- DNS is managed by **GoDaddy**.

---

## TLS / Certificate

- **ACM certificate** issued for `mike.agov.app`.
- The certificate is attached to the ALB HTTPS listener.
- Renewal is handled automatically by AWS Certificate Manager.

---

## ECS

- **Cluster:** `atlas-mike-staging-cluster`
- **Services:**

| Service | Revision |
| --- | --- |
| frontend | rev 5 |
| backend | rev 7 |
| supabase | rev 12 |

All services run on **ARM64** architecture.

---

## RDS

- **DB instance:** `atlas-mike-staging-db`

---

## S3

- **Bucket:** `atlas-mike-staging-documents`
- **Access:** private — access is granted via the ECS task **IAM role**, not
  static credentials.

---

## Secrets

- **Secrets Manager secret:** `atlas-mike-staging-app-secrets`
- Contains application secrets (anon key, service keys, etc.).
- Secrets are injected into ECS tasks at runtime; they are **never** stored in
  this document or in the repository.

---

## Staging User

- **Email:** `mike-admin@atlasgov.com`
- **Password:** delivered separately and rotated regularly. The password value
  is **never** included in documentation.

---

## Quick reference

| Item | Value |
| --- | --- |
| URL | `https://mike.agov.app` |
| ALB hostname | `atlas-mike-staging-alb-1821218227.us-east-1.elb.amazonaws.com` |
| ECS cluster | `atlas-mike-staging-cluster` |
| Frontend service | rev 5 |
| Backend service | rev 7 |
| Supabase service | rev 12 |
| RDS instance | `atlas-mike-staging-db` |
| S3 bucket | `atlas-mike-staging-documents` (private, IAM role) |
| Secrets Manager secret | `atlas-mike-staging-app-secrets` |
| DNS | `mike.agov.app` → ALB (GoDaddy) |
| ACM certificate | `mike.agov.app` |
| HTTP → HTTPS | Redirect |
| Staging user | `mike-admin@atlasgov.com` (password delivered separately) |
