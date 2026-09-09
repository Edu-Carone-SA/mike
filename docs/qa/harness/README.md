# QA Harness — Sprints 1–4 (staging)

Harnesses de aceitação automatizados executados contra o staging `https://mike.agov.app`. Entregues no repo para que o QA independente possa executá-los sem depender do ambiente do desenvolvedor (resolve **QA-HARNESS-001** do Relatório Final de Aceitação de 06/09/2026 — 27 casos BLOCKED por falta de harness executável).

## Pré-requisitos

- Python 3.9+ (stdlib apenas — `urllib`, `json`, `re`, `hashlib`)
- Conta de QA no staging (email + senha)
- Credenciais fornecidas **exclusivamente por variáveis de ambiente** — nenhum secret em arquivo, código ou log

## Segurança operacional (importante)

- **Não-destrutivo por padrão**: sem `MIKE_QA_ALLOW_WRITES=1` os scripts apenas imprimem `dry-run: ...` e saem — nenhuma requisição é feita.
- As suítes **criam** projetos/documentos/chats próprios na conta de QA (dados sintéticos) — nunca leem ou alteram dados de clientes.
- Nenhum script imprime ou grava token, senha, header `Authorization` ou URL assinada; o JSONL de evidência é filtrado (`token`, `url`, `password` removidos) e URLs de download são registradas apenas como `url_kind` (relativa/absoluta), nunca o valor.
- Fixtures são documentos sintéticos controlados (ver abaixo).

## Variáveis de ambiente

**Obrigatórias** (todos os scripts):

| Variável | Uso |
|---|---|
| `MIKE_QA_EMAIL` | Login da conta de QA (staging) |
| `MIKE_QA_PASSWORD` | Senha da conta de QA |
| `MIKE_QA_ALLOW_WRITES=1` | Opt-in explícito para executar (sem ela: dry-run) |

**Obrigatórias por suíte:**

| Variável | Uso | Exigida por |
|---|---|---|
| `MIKE_QA_ANON_KEY` | Chave anon do Supabase (login) | sprint1, 2, 4 |
| `MIKE_QA_SUPA_URL` | URL do PostgREST (introspecção de jobs/checkpoints) | sprint1 |
| `MIKE_QA_SUPA_SERVICE_KEY` | Service key (introspecção) | sprint1 |
| `MIKE_QA_SECRETS_JSON` | JSON `{"SUPABASE_ANON_KEY": "..."}` quando o script precisa de secrets de app | sprint2, 4 |
| `MIKE_QA_EVIDENCE` | Caminho do JSONL de evidência (default: cwd) | opcional |

Quem tiver AWS CLI + perfil `chico-bacon` pode omitir `MIKE_QA_ANON_KEY` — o sprint1 recupera de `atlas-mike-staging-app-secrets` (Secrets Manager, us-east-1).

## Execução

```bash
# 1. Sempre verificar o build ANTES de rodar:
curl -s https://mike.agov.app/health
# → "commit" + "deploy_run" devem bater com o SHA sob avaliação

# 2. Dry-run (valida configuração sem tocar no staging):
python3 docs/qa/harness/sprint4_integrity.py
# → "dry-run: set MIKE_QA_ALLOW_WRITES=1 ..." (comportamento esperado)

# 3. Execução real:
export MIKE_QA_EMAIL=... MIKE_QA_PASSWORD=... MIKE_QA_ALLOW_WRITES=1 ...
python3 docs/qa/harness/sprint1_acceptance.py
```

**Timeouts**: cada suíte é sequencial (uma execução por vez); budgets internos: login 60s, requests 60s, SSE de chat até 1800s (30 min — orçamento completo de tools com pausa+retomada). Suíte completa sprint1: ~10–15 min por execução. Rode no `tmux`/`screen` ou `nohup`.

## Limpeza

Os artefatos criados (projetos `QA-*`, documentos, chats) ficam na conta de QA — podem ser deletados pela UI (Projects → delete) a qualquer momento; os scripts não deletam nada automaticamente. O JSONL de evidência é local (cwd ou `MIKE_QA_EVIDENCE`) — remover após arquivar.

## Fixtures (documentos controlados)

| Arquivo | Conteúdo | Uso |
|---|---|---|
| `fixtures/s4-minuta.docx` | Contrato de prestação de serviços sintético (PT-BR): 4 cláusulas (objeto/remuneração R$ 50.000/vigência 12 meses/assinaturas) + ANEXO I (termo de confidencialidade) — **oráculo do gate de integridade** | sprint4_integrity |
| `fixtures/s4-test-contract.docx` | Services agreement sintético (EN): ACME Corp / Beta LLC, consultoria | sprint4_acceptance |

Ambos 100% sintéticos (partes fictícias, valores fictícios) — nenhum dado real de cliente.

## Suítes e cobertura

| Script | Casos QA cobertos | O que valida |
|---|---|---|
| `sprint1_acceptance.py` | JOB-01, JOB-02 | Plano determinístico por seções; pausa por `tool_budget`; checkpoint; retomada no mesmo `job_id`; síntese final obrigatória |
| `sprint2_acceptance.py` | DOC-01, DOC-02, DOC-03, DOC-04 | Upload → pipeline (`analysis_ready`), lotes 1/5/10, idempotência (reenvio idêntico = mesmo doc), `/ready` backlog |
| `sprint4_acceptance.py` | DL-01, DL-02 | Botão vs API mesmo SHA-256, `Content-Disposition` filename, 404 doc inexistente, 401/erro token inválido |
| `sprint4_integrity.py` | INT-01, INT-02 | Edição autorizada preserva manifesto (hash); edição destrutiva (heading estrutural) bloqueada pelo gate |
| `pr86_long_response_integrity.py` | STREAM-01 (P1 do reaceite PR #86) | Resposta longa com marcadores obrigatórios (`Achado N` × N + `CONCLUSÃO FINAL`); FAIL se marcador faltar, se a persistida pós-reload for menor que a emitida no stream, ou houver terminal duplicado/anômalo (`error`/`job_paused`) |

Regressões hoje BLOCKED que passam a ser executáveis: **DOC-02, DOC-04** (dependiam de harness), além dos reatestes JOB/INT/DL acima.

## Formato do JSONL de evidência

Uma linha por caso, sanitizada (sem credenciais):

```json
{"test": "build_identity", "commit": "<sha>", "deploy_run": "<run>", "ts": "2026-09-07T02:11:00Z"}
{"test": "c2_destructive_edit", "ok": true, "document_id": "...", "version_id": "...", "duration_s": 41.2, "...": "..."}
{"label": "batch-5", "project_id": "...", "files": 5, "sha": "<upload-idempotency-key>", "states": [{"doc": "...", "state": "ready", "wait_s": 12.3}], "consistent": true, "all_ready": true}
```

Campos por linha: `test`/`label` (caso), `commit`+`deploy_run` (identidade do build — gravada como primeiro record), `ok`/`error` (resultado), `duration_s` (duração), IDs de correlação (`job_id`, `document_id`, `version_id`, `project_id`, `chat_id`, `request_id` conforme o caso), e detalhes do oráculo (SHA-256 truncado, estados, contagens).

## Notas de integridade

- Evidência de telemetria (CloudWatch) continua não disponível ao QA: os harnesses capturam o que o backend reporta (`job_id`/`request_id`/`version_id`/SHA-256), permitindo correlação posterior pelo time de dev.
- Build sob teste é identificado por `/health` (`commit` + `deploy_run`) antes de qualquer caso — o resultado só vale para aquele SHA.
