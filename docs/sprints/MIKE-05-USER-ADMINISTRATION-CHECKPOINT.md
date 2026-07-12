# Sprint 5: MIKE-05-USER-ADMINISTRATION — Checkpoint

**Branch:** `sprint/MIKE-05-USER-ADMINISTRATION`
**Base SHA:** `5359c00` (origin/main)
**Started:** 2026-07-12

## Objetivo
Entregar administração de usuários no próprio Mike: visualizar, criar, bloquear, redefinir senha, revogar sessões, sem depender de CLI ou banco direto.

## Modelo de Dados
- `user_profiles` existente ganha colunas: `role`, `status`, `last_login_at`, `created_by`, `disabled_at`, `disabled_by`
- GoTrue (`auth.users`) continua como fonte de verdade da identidade
- Tabela `admin_audit_log` para auditoria

## Endpoints
- `GET /admin/users` — listar
- `POST /admin/users` — criar/convitar
- `PATCH /admin/users/:id/role` — alterar papel
- `PATCH /admin/users/:id/disable` — bloquear
- `PATCH /admin/users/:id/enable` — reativar
- `POST /admin/users/:id/reset-password` — redefinir senha
- `POST /admin/users/:id/revoke-sessions` — revogar sessões

## Frontend
- Nova aba em Settings: "User Administration" (só visível para admins)
- Página em `/account/user-administration`

## Status
- [x] Branch criada
- [x] Diagnóstico do modelo atual
- [ ] Migration
- [ ] Backend (middleware + rotas)
- [ ] Frontend
- [ ] Testes
- [ ] Gates + PR + deploy
