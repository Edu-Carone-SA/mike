# Mike — Suite de QA: Sprints 1–4

**Plataforma:** Mike (Atlas Governance)
**Ambiente:** https://mike.agov.app (Staging)
**Baseline:** commit `e7d15fb` (deploy run `34055645102`) — PRs #44–#46, #48–#61
**Data:** 06/09/2026
**Responsável pela execução:** _[preencher]_
**Escopo:** tudo desenvolvido nas Sprints 1–4 (jobs de streaming, pipeline de documentos, tabular/workflow, integridade de minutas, download e viewer)

---

## Como usar este documento

Cada teste tem ID único (`<AREA>-NN`), prioridade, pré-requisitos, passos e resultado esperado. Ao final de cada teste registre **Status** (✅/❌/⚠️/⏭️), **Evidência** (print/vídeo/job_id/request_id) e **Notas**.

**Prioridades:** P0 crítico (bloqueia uso principal) · P1 alto · P2 médio · P3 baixo.

**Evidência obrigatória** (padrão do plano de sprints): todo defeito deve ser correlacionado a SHA do deploy, `job_id`/`request_id` quando houver, e hora. CI verde não substitui evidência de comportamento.

**Conta de teste:** usar a conta de staging fornecida. Modelo padrão: `deepseek/deepseek-v4-flash`.

**Documentos de teste:** os arquivos usados pela bateria automatizada estão em `/tmp/mike-e2e/` (minuta controlada `s4-minuta.docx`, contratos Petronect/FioSaúde usados na Sprint 1). Para PDFs escaneados grandes (10/30/50MB), aguardar arquivos reais ou aprovar uso de sintéticos.

---

# 1. Sprint 1 — Jobs de streaming (retomada e orçamento)

## JOB-01 — Resposta longa completa sem pausa indevida (P0)
**Pré:** Logado; projeto com 2+ documentos reais (ex.: contrato Petronect ou FioSaúde)
**Passos:**
1. Abrir chat do projeto
2. Pedir: "Analise todos os documentos deste projeto e liste cada obrigação, prazo e responsável, seção por seção."
3. Aguardar (pode levar 2–5 min; múltiplas ferramentas são chamadas)
**Esperado:** Resposta completa. A barra/log mostra plano de análise antes da 1ª ferramenta (seções a cobrir). Sem pausa por orçamento antes da síntese. Estado final do job: `completed`.
**Evidência:** `job_id` (visível na resposta do sistema ou rede), tempo total, nº de checkpoints.

## JOB-02 — Pausa por orçamento e retomada no MESMO job (P0)
**Pré:** JOB-01 ok
**Passos:**
1. Pedir análise longa e complexa (ex.: "Extraia todas as cláusulas de todos os documentos e comente riscos de cada uma")
2. Se o job pausar (`paused` com evento SSE), clicar em retomar ("Termine a tarefa")
3. Observar se a resposta continua de onde parou
**Esperado:** Retomada reusa o MESMO `job_id` (não cria job novo), checkpoints anteriores não são reprocessados, resposta final é coerente (sem repetição de seções já sintetizadas). Estado final `completed`.
**Evidência:** job_id antes/depois da retomada (devem ser iguais), tempo da retomada, seções repetidas (se houver).

## JOB-03 — Síntese após orçamento de ferramentas (P1)
**Pré:** JOB-01 ok
**Passos:**
1. Forçar muitas iterações de ferramentas (pedido que exige ler vários docs e comparar)
2. Observar o comportamento quando o modelo atinge o limite de iterações com tools
**Esperado:** As 2 últimas iterações são SEM ferramentas (reserva de síntese) — o assistente encerra com síntese textual completa, não trunca no meio de uma chamada de tool. Estado `completed`, não `failed`.
**Evidência:** resposta final, `final_reason` se visível.

## JOB-04 — Cancelamento ao fechar aba durante job (P1)
**Passos:**
1. Iniciar job longo (JOB-02)
2. Fechar a aba no meio do processamento
3. Reabrir o mesmo chat
**Esperado:** Job marcado `cancelled` (não fica rodando órfão, não fica `running` eternamente). Chat mostra o estado do último job. Nenhum consumo de LLM desnecessário após fechamento (checar logs se possível).
**Evidência:** estado do job ao reabrir, hora do fechamento.

## JOB-05 — Plano determinístico por seções antes da 1ª tool (P2)
**Passos:**
1. Iniciar JOB-01 com DevTools aberto (aba Network, SSE)
2. Inspecionar o primeiro evento do stream
**Esperado:** Evento `analysis_plan` chega ANTES de qualquer `tool_call`, contendo as seções que serão cobertas. O system prompt é estendido com o plano (não vaza para o usuário como texto).
**Evidência:** print do evento SSE.

## JOB-06 — Cenário multifornecedor documentado (P3, skip permitido)
**Nota:** apenas OpenRouter está ativo. Testar apenas se outro provider for configurado.

---

# 2. Sprint 2 — Pipeline de documentos (upload → pronto)

## DOC-01 — Upload único DOCX fica pronto (P0)
**Passos:**
1. Novo projeto → "Adicionar documento"
2. Enviar 1 DOCX (ex.: `s4-minuta.docx`)
**Esperado:** Progresso por arquivo visível (`upload-progress`), estados `queued→extracting→ready` sem travar. Pronto em < 60s (DOCX sem OCR). Documento abre no viewer com texto extraído.
**Evidência:** tempo de processamento, status final.

## DOC-02 — Upload em lote sequencial 5 e 10 arquivos (P0)
**Passos:**
1. Novo projeto → enviar 5 DOCX de uma vez
2. Repetir em outro projeto com 10
**Esperado:** Uploads SEQUENCIAIS (não simultâneos), contagem individual por arquivo (ex.: "3/10"), falha em um arquivo não bloqueia os demais. Ao final: 5/5 e 10/10 documentos `ready`. Reload da página mostra N documentos exatos (sem duplicatas).
**Evidência:** contagem final após reload, prints do progresso.
**Nota regressão:** este teste cobre o fix #55 (dedup pré-insert). Se aparecer N+1 documentos após reload, é o bug que o PR #55 corrigiu — reprovado imediatamente.

## DOC-03 — Retry de arquivo com falha (P1)
**Passos:**
1. Durante lote (DOC-02), simular falha (ex.: desligar rede por um arquivo, ou enviar arquivo corrompido)
2. Usar o botão de retry do arquivo
**Evidência/Esperado:** Retry funciona e o arquivo fica `ready`; os demais não são afetados; nenhum documento duplicado criado (regressão #55).
**Limite conhecido (não é bug):** retry de OCR recomeça a extração do zero (documentado no runbook `docs/operations/document-pipeline.md`).

## DOC-04 — Idempotência: reenvio do MESMO arquivo não duplica (P0)
**Passos:**
1. Enviar `s4-minuta.docx` a um projeto
2. Aguardar ficar `ready`
3. Enviar o MESMO arquivo de novo (mesmo nome/tamanho/data)
4. Reload da página
**Esperado:** Apenas 1 documento (a chave de idempotência é `project.id + file.name + file.size + file.lastModified`). O backend retorna o documento existente (200), não cria novo.
**Evidência:** contagem de documentos antes/depois.

## DOC-05 — Estados do pipeline visíveis na UI (P1)
**Passos:**
1. Enviar PDF escaneado pequeno (força OCR)
2. Observar o card do arquivo durante o processamento
**Esperado:** Card mostra progresso de processamento (`processing_job`), transições visíveis, sem "loading" eterno. Ao terminar, badge/estado `ready`.
**Evidência:** print das transições.

## DOC-06 — Prontidão do pipeline `/ready` (P2)
**Passos:**
1. `curl https://mike.agov.app/ready` (ou abrir no browser)
**Esperado:** JSON com `document_pipeline`: `backlog: 0`, sem `backlog_alert`. Após DOC-02, backlog volta a 0 em minutos.
**Evidência:** JSON coletado em 2 momentos.

## DOC-07 — PDFs escaneados grandes 10/30/50MB (P1 — AGUARDANDO ARQUIVOS)
**Status:** ⏭️ adiado — precisa de PDFs reais fornecidos ou aprovação de sintéticos. Registrar quem decidiu.

## DOC-08 — Reload durante processamento (P1)
**Passos:**
1. Enviar lote de 5
2. Recarregar a página no meio do processamento
**Esperado:** Ao voltar, os arquivos aparecem com o estado real (não somem, não voltam a `queued`). Consistência entre o que a UI mostra e o que o backend tem.
**Evidência:** estados antes/depois do reload.

---

# 3. Sprint 3 — Tabular e workflow

## TAB-01 — `/generate` sem documentos selecionados (P0)
**Pré:** Projeto com documentos; nenhuma seleção marcada (TAB-001 removeu o auto-select-all)
**Passos:**
1. Novo tabular review → NÃO selecionar documentos → clicar em Executar/Generate
**Esperado:** Banner de pré-condição claro em PT-BR com causa e ação (ex.: "Nenhum documento selecionado — selecione ao menos um documento de origem"). NADA é gerado, nenhum fallback para "todos os documentos do projeto".
**Evidência:** print do banner; nenhum job/run criado.
**Nota:** cobre o fix #54 (remoção do fallback) — se gerar com todos os docs do projeto sem seleção, é o bug que o PR #54 corrigiu.

## TAB-02 — Documento de outro usuário (P1)
**Passos:**
1. Logar com usuário A; logar em aba anônima com usuário B
2. B cria projeto com documento; A tenta rodar tabular referenciando o documento de B (via seleção compartilhada, se houver)
**Esperado:** Banner `documents_access_denied` (PT-BR, causa + ação), código HTTP 403 no backend. Nenhum vazamento de conteúdo do documento de B.
**Evidência:** print + status HTTP.

## TAB-03 — Sem API key de modelo (P1)
**Pré:** Conta sem chave de modelo configurada (ou chave removida em Settings)
**Passos:**
1. Tentar rodar tabular
**Esperado:** Banner `missing_api_key` (PT-BR, causa + ação). Sem erro 500, sem stack trace na UI.
**Evidência:** print.

## TAB-04 — Run tabular com seleção explícita (P0)
**Passos:**
1. Selecionar 2 de 5 documentos do projeto → Executar
2. Observar células/reasoning gerados
**Esperado:** Só os 2 documentos selecionados são usados (checar menções nas células/reasoning). Ciclo de vida com `run_started`/`run_completed` (se falha: `run_failed` com motivo legível). Células persistem ao recarregar (pending/running/done/failed).
**Evidência:** docs citados, reload mantém células.

## TAB-05 — Locale pt-BR no tabular (P1)
**Passos:**
1. Rodar TAB-04 com documentos em português
**Esperado:** `summary` e `reasoning` das células em PORTUGUÊS (não em inglês). Diretiva de locale ativa no prompt.
**Evidência:** print de células.

## TAB-06 — Review de carga: 18 colunas × 2 fontes (P1 — CRITÉRIO PENDENTE S3)
**Pré:** Dois documentos ricos (Petronect + FioSaúde), tabular com 18 colunas mapeadas
**Passos:**
1. Rodar o tabular com as 18 colunas × 2 fontes
2. Navegar horizontal e verticalmente pela grade durante o processamento
3. Recarregar a página
**Esperado:** Página não trava (scroll fluido), células atualizam sem flicker intolerável, reload restaura o estado completo (células done/failed persistentes).
**Evidência:** vídeo curto do scroll, tempo até completar.

## TAB-07 — Workflow de contrato em PT-BR ponta a ponta (P0 — CRITÉRIO PENDENTE S3)
**Pré:** Projeto com documento de contrato; workflow de contrato disponível
**Passos:**
1. No chat do projeto, pedir para executar o workflow de análise de contrato completo
2. Observar a narração das ferramentas (tool narration) durante a execução
3. Deixar concluir OU pausar de forma tipada (aguardando input do usuário)
**Esperado:**
- Interface, narração de tools e relatório final em PORTUGUÊS
- Workflow conclui (`completed`) com relatório, OU pausa tipada pedindo input ao usuário (não falha genérica, não loop)
- Se pausado: responder o input retoma sem perder contexto
**Evidência:** job_id, prints do relatório/narração, estado final.

## TAB-08 — Chat responde no idioma do usuário (P2)
**Passos:**
1. Chat simples em português: "Resuma este documento em 5 pontos"
2. Repetir em inglês: "Summarize this document in 5 points"
**Esperado:** Resposta no idioma da pergunta (diretiva de locale do #56). Tool narration acompanha o idioma.
**Evidência:** prints.

---

# 4. Sprint 4 — Integridade de minutas (gate de manifesto)

## INT-01 — Edição autorizada preserva estrutura (P0)
**Pré:** Projeto com a minuta controlada (`s4-minuta.docx`: 4 cláusulas, ANEXO I, ANEXO II, 2 blocos de assinatura)
**Passos:**
1. Anexar a minuta em um chat
2. Pedir: "Altere o valor 'R$ 50.000,00' por 'R$ 65.000,00' na cláusula 2. Não altere mais nada."
3. Baixar o resultado e abrir no Word
**Esperado:** Novo versão criada (`assistant_edit`). Diff mostra APENAS a troca do valor. ANEXO I, ANEXO II, 4 cláusulas e blocos de assinatura intactos. Edição aplicada como tracked change (visível em Revisão → Controlar Alterações).
**Evidência:** hash SHA-256 do arquivo, prints do Word, `version_number`.

## INT-02 — Edição destrutiva bloqueada (P0)
**Pré:** INT-01 ok
**Passos:**
1. Em novo chat com a minuta anexada: "Exclua o parágrafo inteiro que começa com 'ANEXO II — POLÍTICA DE PRIVACIDADE'. Não altere mais nada."
2. Observar a resposta do assistente
**Esperado:** A exclusão do heading do anexo é BLOQUEADA com mensagem legível: "Edit blocked by draft-integrity check — the candidate version would lose structural content" (ou PT-BR equivalente na narração). O documento NÃO perde o anexo. Parágrafos comuns podem ser editados normalmente (o gate protege partes estruturais).
**Evidência:** mensagem de bloqueio, estado final do doc (anexos presentes).

## INT-03 — Contorno via tracked changes bloqueado (P0 — REGRESSÃO #61)
**Passos:**
1. Variante do INT-02: pedir para "marcar como exclusão" ou excluir em múltiplas etapas (o modelo pode fatiar o pedido)
**Esperado:** Heading do anexo dentro de `<w:del>` conta como REMOÇÃO — bloqueado mesmo via tracked deletion. Anexo permanece no documento final.
**Evidência:** documento final com anexo, mensagens de bloqueio.

## INT-04 — Anexos do chat visíveis para as tools (P0 — REGRESSÃO #60)
**Passos:**
1. Anexar documento via paperclip do chat (não via projeto)
2. Pedir: "Leia o documento anexado (doc-0) e me diga o título"
**Esperado:** A ferramenta `read_document` LÊ o documento (antes do fix #60: "Document not found" com o doc pronto no storage). Vale para `/chat` e chat de projeto.
**Evidência:** resposta citando o título real.

## INT-05 — Minuta gerada sem bloco de assinaturas é rejeitada (P1)
**Passos:**
1. Pedir para gerar um documento contract-like SEM bloco de assinaturas ("gera um contrato sem campos de assinatura")
**Esperado:** Geração rejeitada ANTES de publicar (nada versionado), com erro legível. Nenhuma minuta publicada incompleta.
**Evidência:** mensagem, contagem de versões (inalterada).

## INT-06 — Geração normal de minuta funciona (P1)
**Passos:**
1. Pedir geração de minuta padrão (com assinaturas)
**Esperado:** Documento gerado, versionado, abre no Word sem corrupção, contém bloco de assinaturas.
**Evidência:** hash, versão.

---

# 5. Sprint 4 — Download unificado

## DL-01 — Botão e API entregam o MESMO arquivo (P0)
**Passos:**
1. Baixar documento pelo botão da UI
2. Baixar o mesmo documento/version via API (`GET /single-documents/:id/url` → seguir o link)
3. Comparar hashes (ex.: `shasum -a 256`)
**Esperado:** SHA-256 idêntico, mesma versão, `Content-Disposition: attachment` com filename correto.
**Evidência:** hashes.

## DL-02 — Token expirado → 410 (P1)
**Passos:**
1. Obter URL de download (token vale 5 min)
2. Esperar > 5 min (ou usar token expirado capturado)
3. Acessar o link
**Esperado:** HTTP 410 Gone com corpo claro ("token expirado"), não 500, não redirect para login.
**Evidência:** status + corpo.

## DL-03 — Sem acesso → 403 (P1)
**Passos:**
1. Usuário B tenta acessar link de download do documento do usuário A (token emitido para A, sessão de B)
**Esperado:** HTTP 403 com motivo. Não vaza conteúdo. (Antes: 404 genérico enganoso.)
**Evidência:** status.

## DL-04 — Token inválido/tampered → 404 (P2)
**Passos:**
1. Modificar caracteres do token na URL
**Esperado:** HTTP 404, sem detalhe interno.
**Evidência:** status.

## DL-05 — Links antigos (tokens legados) continuam válidos (P2)
**Passos:**
1. Baixar um documento cujo link apareceu em chat ANTES do deploy #58 (histórico antigo)
**Esperado:** Download funciona (tokens legados HMAC sem expiração permanecem válidos por compatibilidade). Registrar prazo para eventual revogação futura.
**Evidência:** sucesso/falha do download.

## DL-06 — Auditoria de download (P2)
**Passos:**
1. Realizar DL-01 (sucesso) e DL-03 (negado)
2. Pedir ao time DevOps os logs `[download]` no CloudWatch (`/ecs/atlas-mike-staging-backend`)
**Esperado:** Linhas `event=delivered` (com user_id, document_id, bytes) e `event=denied` para o 403. Chave-valor, sem PII além de IDs.
**Evidência:** linhas de log.

---

# 6. Sprint 4 — Estabilidade do viewer

## VIEW-01 — Resize não perde a página atual (P1)
**Passos:**
1. Abrir PDF de várias páginas no viewer
2. Navegar até a página 5
3. Redimensionar a janela do browser (e alternar sidebar/painel)
**Esperado:** Viewer re-renderiza mantendo a página 5 visível (antes do #59: voltava ao topo).
**Evidência:** vídeo curto.

## VIEW-02 — Citação aberta sobrevive a resize (P1)
**Passos:**
1. Com uma citação/highlight ativo no viewer, redimensionar a janela
**Esperado:** Highlight persiste e o scroll volta até a citação (não some, não desloca para outra página).
**Evidência:** vídeo.

## VIEW-03 — Stream de 5 minutos sem degradação (P0 — CRITÉRIO PENDENTE S4)
**Pré:** JOB-01 em execução com viewer aberto em documento citado
**Passos:**
1. Iniciar análise longa que cita o documento várias vezes
2. Manecer o viewer aberto durante ~5 min de stream (novas citações chegando por SSE)
3. Redimensionar a janela no MEIO do stream
**Esperado:** Canvas não pisca nem zera a cada chunk; citações novas aplicam highlight sem re-render destrutivo; após resize no meio do stream, documento/citação permanecem.
**Evidência:** vídeo do teste completo, nota sobre qualquer flicker.

## VIEW-04 — Reload durante stream (P2)
**Passos:**
1. Reload da página durante JOB-01
2. Reabrir o chat
**Esperado:** Chat restaura com o job em andamento/estado; retomada disponível (JOB-02), viewer reabre o documento sem erro.
**Evidência:** prints.

---

# 7. Cross-cutting / regressões gerais

## XC-01 — Nenhum N+1 de documentos (P0)
Coberto por DOC-02/DOC-04 (regressão #55). Se qualquer duplicata aparecer: reprovado, anexar contagem antes/depois.

## XC-02 — Erros nunca vazam stack trace (P1)
Durante TODOS os testes acima: nenhuma resposta de UI mostra stack trace, SQL, ou internals. Erros de API são JSON estruturado com mensagem acionável.

## XC-03 — Correlação nos logs (P2)
Para 1 defeito qualquer encontrado: `job_id`/`request_id` rastreável no CloudWatch, correlacionado ao SHA do deploy. Se não for rastreável, registrar como falha de observabilidade.

## XC-04 — Bateria automatizada de regressão (P2 — execução DevOps/QA-tech)
Rodar `sprint2_acceptance.py` e `sprint4_acceptance.py` (harness em `/tmp/mike-e2e/`) contra o staging e anexar os JSONL resultantes:
- Sprint 2: batch 1/5/10 → `docs_after_reload = N` exato, todos `ready`, `/ready` backlog 0
- Sprint 4: DL-01..DL-04 automatizados (hash, 410/403/404) + INT-01..INT-03 via `sprint4_integrity.py` (anexo bloqueado, valor trocado, estrutura preservada)

---

# Resumo de execução (preencher ao final)

| Área | Total | Passou | Falhou | Parcial | Skip |
|---|---|---|---|---|---|
| Sprint 1 — Jobs (JOB) | 6 | | | | |
| Sprint 2 — Pipeline (DOC) | 8 | | | | |
| Sprint 3 — Tabular (TAB) | 8 | | | | |
| Sprint 4 — Integridade (INT) | 6 | | | | |
| Sprint 4 — Download (DL) | 6 | | | | |
| Sprint 4 — Viewer (VIEW) | 4 | | | | |
| Cross (XC) | 4 | | | | |

**Gates para seguir para a Sprint 5 (segurança/rastreabilidade):** JOB-01/02, DOC-01/02/04, TAB-01/04/07, INT-01/02/03/04, DL-01, VIEW-03 todos ✅ (ou risco formalmente aceito por escrito). Nenhum P0 aberto.

## Pendências conhecidas (não bloqueiam, mas registrar se aparecerem)
- `final_reason=tool_budget` impreciso quando a pausa vem de `ask_inputs` (deveria ser `awaiting_user_input`) — dívida registrada
- Retry de OCR recomeça do zero — limitação documentada
- DOC-07 (PDFs 10/30/50MB) aguardando arquivos reais ou aprovação de sintéticos
