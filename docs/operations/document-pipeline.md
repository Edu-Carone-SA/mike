# Document Pipeline — SLOs, Limites e Operação (Sprint 2)

## Visão geral

Uploads de documentos são processados por um pipeline assíncrono
(`document_jobs`): `queued → uploading → extracting → (ocr) → indexing →
ready | failed | cancelled`. O worker roda in-process no backend e persiste
o texto extraído em `document_versions.extracted_text`.

## Contrato de prontidão (público)

`GET /single-documents/:id` expõe, em todos os estados do pipeline:

| Campo | Significado |
|---|---|
| `analysis_ready` | `true` quando há texto extraído utilizável |
| `extracted_text_length` | caracteres extraídos |
| `processing_state` | estado atual do job (`queued|uploading|extracting|ocr|indexing|ready|failed|cancelled`; legado sem job: `pending_extraction`) |
| `failure_reason` | motivo tipado da falha (`timeout|network|storage_full|out_of_memory|empty_extraction|storage_unavailable|missing_*|processing_error`) |
| `updated_at` | última atualização |

Progresso por arquivo: `GET /single-documents/:id/processing`
(`pagesProcessed`, `pagesTotal`, `attempt`, `maxAttempts`).

**Consumidores não devem depender de `content`** — os indicadores acima
são a superfície pública de prontidão.

## Idempotência

Toda criação de job aceita `X-Idempotency-Key` (única por usuário).
O frontend deriva a chave de `nome+size+mtime+destino`, então retry
após reload/reabrir o modal **nunca duplica** o documento.

## SLOs iniciais (metas, monitoradas via `/ready`)

| Cenário | Meta |
|---|---|
| Documento textual ≤ 10 MB | pronto em ≤ 60 s |
| OCR de PDF escaneado ≤ 30 MB | pronto em ≤ 5 min, com progresso de páginas |

## Limites configuráveis (env)

| Variável | Default | Efeito |
|---|---|---|
| `DOCUMENT_JOB_POLL_MS` | `2000` | intervalo do worker |
| `DOCUMENT_JOB_WORKER` | on | `off` desabilita o worker (containers de teste) |
| `DOCUMENT_JOB_BACKLOG_ALERT` | `20` | backlog acima disso liga `backlog_alert` no `/ready` |

## OCR — política

- PDFs com camada de texto < 20 chars/página vão para OCR (tesseract).
- Progresso por página é persistido (`pages_processed`); o retry
  recomeça do zero da extração, mas o texto já extraído permanece
  cacheado no version até nova tentativa completar.

## Operação / alertas

- `/ready` expõe `document_pipeline.backlog`, `oldest_queued_seconds` e
  `backlog_alert` — o monitor de uptime/ECS deve alertar quando
  `backlog_alert=true` (fila parada) além dos alertas existentes de
  ECS desired count zero e RDS parada (runbook operations).
- Telemetria: linhas `[document-job] event=...` no CloudWatch
  (`created|deduped|claimed|completed|failed|crashed`) com `job_id`,
  `document_id`, `request_id`, `build_sha`, `attempt`, `duration_ms`.
