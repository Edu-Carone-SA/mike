# Sprint MIKE-06 — Performance do streaming LLM + migração total para OpenRouter

**Autor:** Januário (engenharia de frota)
**Responsável:** Chico Bacon
**Projeto:** Mike (assistente jurídico — `Edu-Carone-SA/mike`)
**Staging:** https://mike.agov.app
**Base:** `main` (HEAD `f029a1c`, branch atual `docs/qa-harness-long-response` — criar branch nova de `origin/main`)

---

## 1. Contexto e sintoma

O Edu reporta, há dezenas de sprints, os mesmos problemas no Mike:

- **Respostas demoram MUITO** (minutos para uma pergunta simples).
- **Trava** ("Working" indefinidamente).
- **Entrega frases pela metade** (resposta termina no meio de uma palavra).

Já tentaram trocar de modelo sem efeito — porque o problema **não é o modelo**, é a **orquestração do streaming** no backend.

## 2. Diagnóstico (evidência dos logs CloudWatch)

Logs do backend (`/ecs/atlas-mike-staging-backend`, stream mais recente) mostram a assinatura exata:

```
[llm] model=z-ai/glm-5.3 attempt=1 prompt=13915 completion=8192
[llm] model=z-ai/glm-5.3 attempt=2 prompt=13952 completion=8192   ← teto estourado
[llm] model=z-ai/glm-5.3 attempt=2 prompt=13989 completion=8192   ← teto estourado de novo
[llm] model=z-ai/glm-5.3 attempt=2 prompt=14026 completion=8192   ← e de novo
```

### Causa raiz A — auto-continue descontrolado (dominante)

- `backend/src/lib/llm/openrouter.ts:16` define `MAX_OUTPUT_TOKENS = 8192`.
- `backend/src/lib/llm/openrouter.ts:431` define `MAX_CONTINUATIONS = 8`.
- `backend/src/lib/llm/openrouter.ts:606-628` faz **auto-continue** sempre que `finish_reason === "length"`.

Resultado: uma resposta que deveria ter ~1 página vira **até 8 continuações × 8192 tokens = ~65.000 tokens de output** (~80-120 páginas de texto). A cada continuação o **prompt re-alimenta o contexto completo** (`prompt_tokens` cresce: 13915 → 14026 → ...), então cada chamada fica **mais lenta e mais cara**. É o que o usuário sente como "demora MUITO" e "trava".

O mesmo padrão existe em `backend/src/lib/llm/deepseek.ts:352-356` (auto-continue em `finishReason === "length"`).

### Causa raiz B — TTFT não medido corretamente

Nos logs, `time_to_first_token_ms=0` ou `1` em quase todas as chamadas, mesmo quando `duration_ms` mostra 10,5s. A métrica mente, então nenhuma sprint anterior conseguiu enxergar a latência real. Isso precisa ser corrigido para permitir diagnóstico futuro.

### Causa raiz C — stall watchdog ausente nos adapters legados

- O watchdog **já existe** em `backend/src/lib/llm/openrouter.ts:458-495` (`STALL_TIMEOUT_MS = 90_000`, race de cada `reader.read()` contra timer + `reader.cancel()`).
- **NÃO existe** em `backend/src/lib/llm/deepseek.ts:277` (read loop sem timeout) nem em `backend/src/lib/llm/openai.ts:259`.

Foi exatamente esse o mecanismo do incidente documentado: "Working por muitos minutos + resposta terminando no meio de uma palavra = upstream SSE congelado". Migrar tudo para OpenRouter resolve por definição (o watchdog já está lá), mas é bom **portar o watchdog** para qualquer adapter que sobreviva.

---

## 3. Decisão do Edu

> "Chega de usar provedores separados. Vamos **só de OpenRouter**. O admin inputa a chave OpenRouter e escolhe o modelo a partir daí."

Escopo da migração:

1. **Eliminar** os providers `claude`, `gemini`, `openai` e `deepseek` (nativo) da UI e do backend.
2. **Manter somente** `openrouter`.
3. **Admin** (e usuários com per-user key) inputam `OPENROUTER_API_KEY` e escolhem o modelo da lista OpenRouter no painel.

---

## 4. Objetivos da sprint

| # | Objetivo | Critério de aceite |
|---|---|---|
| 1 | Limitar o auto-continue | Resposta nunca gera mais que o teto definido sem decisão explícita |
| 2 | Corrigir medição de TTFT | `time_to_first_token_ms` reflete o tempo real até o 1º token |
| 3 | Garantir stall watchdog em todo streaming | Nenhum `reader.read()` sem timeout no caminho ativo |
| 4 | Migrar para OpenRouter-only | Só `openrouter` aparece; admin escolhe modelo + inputa chave |
| 5 | Verificação E2E | Smoke test real contra staging: resposta curta, rápida, completa |

---

## 5. Trabalho detalhado por área

### 5.1 — Limitar o auto-continue (backend)

**Arquivos:** `backend/src/lib/llm/openrouter.ts` (e, se sobreviver, `deepseek.ts`).

**Problema atual** (openrouter.ts:606-628):
```ts
if (
  finishReason === "length" &&
  fullText &&
  continuationsUsed < MAX_CONTINUATIONS   // 8
) {
  continuationsUsed++;
  messages = [...messages,
    { role: "assistant", content: fullText },
    { role: "user", content: "Continue from where you left off..." },
  ];
  iter--;
  continue;
}
```

**Correção (opções — implementar a mais simples que resolva):**

1. **Reduzir `MAX_CONTINUATIONS` de 8 para 1** (mínimo para completar resposta cortada, sem explodir em 65k tokens). É a mudança de 1 linha e elimina o caso dominante.
2. **E/OU**: instruir o modelo, no system prompt de continuação, a **concluir em poucas linhas** (não re-gerar o restante na íntegra).
3. **Guardrail opcional**: se `continuationsUsed` atingir o limite e ainda houver `finish_reason === "length"`, **cortar de forma graciosa** — finalizar com o texto já gerado + evento terminal `completed` (com `final_reason: "output_truncated"` se quiser rastrear), em vez de persistir frases pela metade.

**Critério:** um chat real contra staging não pode produzir mais que `1 × MAX_OUTPUT_TOKENS` + `1 continuação` (ou seja, teto efetivo ~16k tokens). Nada de 4+ × 8192.

> ⚠️ **Atenção ao QA JOB-02** (documentado na skill): a continuação da MESMA chamada de modelo **não pode consumir tool budget** (`iter--`). Preservar esse comportamento ao mexer no loop.

### 5.2 — Corrigir medição de TTFT (backend)

**Arquivo:** `backend/src/lib/llm/openrouter.ts` (função de stream, bloco 467-503).

**Problema:** `timeToFirstTokenMs` é setado com `Date.now() - streamStart`, mas o log sai `0`/`1` na prática. Suspeita: `streamStart` é inicializado **depois** de o primeiro chunk já ter chegado (ou o primeiro `reader.read()` resolve o header/SSE meta, não o primeiro token de conteúdo). O valor 0 é registrado porque o delta de conteúdo pode vir no mesmo chunk do primeiro `read()`.

**Correção:**

1. Inicializar `streamStart` **antes do `fetch()`** (não dentro do loop), para medir o tempo total até o primeiro token de conteúdo real (inclui latência de rede + TTFB do provider).
2. Só registrar `timeToFirstTokenMs` no **primeiro `choice.delta.content` não-vazio** (não no primeiro chunk SSE, que pode ser só `role`/meta).
3. Se o primeiro evento for `tool_calls` (sem conteúdo), registrar TTFT no primeiro delta de **qualquer natureza** (content, reasoning_content ou tool_call) — mas documentar qual.

**Critério:** após deploy, logs devem mostrar `time_to_first_token_ms` com valores realistas (>0, correlacionados com `duration_ms`). Ex.: uma chamada de 10s deve ter TTFT entre centenas de ms e ~3s, não 0.

### 5.3 — Garantir stall watchdog em todo streaming (backend)

**Arquivo:** `backend/src/lib/llm/openrouter.ts` (já tem — 458-495).

**Ação:** confirmar que o watchdog cobre **todas** as leituras do stream no caminho OpenRouter (inclusive as continuações do auto-continue, que re-entram no `while`). Como a migração será OpenRouter-only, o adapter `openrouter.ts` é o único que precisa ficar sólido.

**Opcional (higiene):** se qualquer adapter legado for mantido temporariamente para `completeText` (título/extração), portar o mesmo `readWithStallTimeout` para ele.

**Critério:** grepar o backend e confirmar que **nenhum** `await reader.read()` no caminho ativo de streaming fica sem race contra o timer de stall.

### 5.4 — Migrar para OpenRouter-only (backend + frontend)

#### 5.4.1 Backend — modelos e provider

**Arquivo:** `backend/src/lib/llm/models.ts`.

- Remover as listas `CLAUDE_*`, `GEMINI_*`, `OPENAI_*`, `DEEPSEEK_*`.
- Manter somente `OPENROUTER_MAIN_MODELS`, `OPENROUTER_MID_MODELS`, `OPENROUTER_LOW_MODELS`.
- Definir os defaults OpenRouter (já são: `deepseek/deepseek-v4-flash`).
- `providerForModel()` passa a retornar `"openrouter"` para todos os IDs (ou remover a função e assumir openrouter).

> **Decisão a confirmar com o Edu:** a lista de modelos OpenRouter a expor. Hoje é `deepseek/deepseek-v4-flash` e `z-ai/glm-5.3`. Manter essas duas, ou expor mais (ex.: `deepseek/deepseek-chat`, modelos Qwen/GLM)? Manter as duas atuais é o mínimo; ampliar é trivial depois.

**Arquivo:** `backend/src/lib/llm/index.ts`.

- `streamChatWithTools()` e `completeText()` passam a chamar **somente** `streamOpenRouter` / `completeOpenRouterText`.
- Remover imports e branches dos providers legados.

**Arquivos de adapter a remover (ou deixar órfãos):**
- `backend/src/lib/llm/claude.ts`, `gemini.ts`, `openai.ts`, `deepseek.ts`.
- Confirmar que nenhum outro módulo importa esses diretamente antes de apagar.

#### 5.4.2 Frontend — seletor de modelos e API keys

**Arquivos (já mapeados):**
- `frontend/src/app/lib/modelAvailability.ts` — `ModelProvider` vira só `"openrouter"`.
- `frontend/src/app/components/assistant/ModelToggle.tsx` — `GROUP_ORDER` vira `["OpenRouter"]`; remover grupos `Anthropic`, `OpenAI`, `DeepSeek`, `Google`.
- `frontend/src/app/(pages)/account/models/page.tsx` — dropdown só OpenRouter (já houve bug de array stale aqui; ver skill pitfall "Hardcoded group arrays").
- `frontend/src/app/(pages)/account/api-keys/page.tsx` — remover os campos `claude`/`openai`/`deepseek`; **manter somente** o campo OpenRouter (`provider: "openrouter"`).
- `frontend/src/app/lib/mikeApi.ts` — tipos `ApiKeyState` e `UserApiKeys` só com `openrouter` (auditar `serializeProfile`/`resolveTitleModel` para não referenciar providers removidos).

**Critério:** no painel `/account/api-keys` e `/account/models`, o único provider visível e funcional é OpenRouter. Modelos de outros providers não aparecem em nenhum dropdown.

### 5.5 — Secrets / deploy (infra)

**Arquivo:** `.github/workflows/deploy-staging.yml`.

- O array `secrets` do backend container deve continuar injetando `OPENROUTER_API_KEY` (já está — ver skill pitfall PR #24).
- Remover referências a `DEEPSEEK_API_KEY` (e outros providers legados) do array de secrets, se a decisão for aposentá-los por completo.
- Confirmar que `AWS Secrets Manager` (`atlas-mike-staging-app-secrets`) mantém a chave OpenRouter.

**Decisão de segurança (não bloqueia o deploy):** a chave OpenRouter continua **server-side** (Secrets Manager) + opcional per-user key. O "admin inputa a chave" pode ser via painel de API keys do próprio Mike (per-user) **ou** via Secrets Manager (server-side). Clarificar com o Edu qual o fluxo desejado: manter server-side como fallback e permitir override por usuário é o recomendado.

---

## 6. Sequência de execução sugerida

1. **Backend — auto-continue** (5.1): mudança de 1-2 linhas, maior impacto.
2. **Backend — TTFT** (5.2).
3. **Backend — modelos/provider OpenRouter-only** (5.4.1).
4. **Frontend — OpenRouter-only** (5.4.2).
5. **Higiene** — remover adapters órfãos (5.4.1) e ajustar secrets (5.5).
6. **Gates locais:** `make lint && make typecheck && make test`.
7. **PR** (descrição: o quê / por quê / como testar / risco).
8. **Deploy staging** e **smoke test E2E** (seção 7).

---

## 7. Verificação E2E (gate de aceite)

Rodar contra `https://mike.agov.app`:

1. **Latência:** enviar uma pergunta simples e medir o tempo até a resposta completa. Meta: resposta curta em < 15s, sem "Working" eterno.
2. **Completude:** a resposta deve terminar com pontuação/sentido completo — **nunca** no meio de uma palavra.
3. **Teto de tokens:** conferir nos logs CloudWatch que nenhuma resposta passou de `1 × MAX_OUTPUT_TOKENS + 1 continuação`. Nada de 4+ × 8192.
4. **TTFT:** logs mostram `time_to_first_token_ms` realista (>0).
5. **Stall:** nenhum `reader.read()` sem watchdog no caminho ativo.
6. **UI:** `/account/api-keys` e `/account/models` só mostram OpenRouter; modelo selecionado persiste e funciona.

**Evidência para o Edu:** prints/logs de cada item + o `time_to_first_token_ms` e `completion_tokens` antes/depois.

---

## 8. Riscos e pitfalls

- **QA JOB-02 (tool budget):** continuação da mesma chamada não pode consumir tool budget. Não quebrar o `iter--`.
- **Array stale de grupos no frontend:** `models/page.tsx` e `api-keys/page.tsx` já tiveram array hardcoded por provider. Auditar TODOS os componentes que filtram por `group`.
- **Lint mais estrito no CI:** `--max-warnings=0` no frontend. Rodar `npx eslint <arquivos>` e tratar todo warning como erro antes do push.
- **Vitest só roda em `frontend/tests/`:** teste novo fora dali é silenciosamente ignorado.
- **Branch protection (1 review + enforce_admins):** Chico autentica como `EduardoCarone`, GitHub bloqueia self-approve. Se o PR precisar merge, coordenar relax temporário da regra via API (ver skill `dev-github-workflow` → `references/branch-protection-relax.md`).
- **Staging desliga às ~23h BRT:** smoke test dentro do horário ligado.
- **`finish_reason: length` vs síntese-reserva:** ao reduzir `MAX_CONTINUATIONS`, garantir que o fluxo não caia na síntese-reserva com output truncado silencioso (ver pitfall "Síntese-reserva mascara a pausa por orçamento" na skill `mike-project-context`).

---

## 9. Definição de pronto (DoD)

- [ ] Auto-continue limitado (teto efetivo documentado e verificado nos logs).
- [ ] TTFT medido corretamente (evidência de valores > 0 correlacionados à duração).
- [ ] Stall watchdog ativo em todo o caminho de streaming ativo.
- [ ] OpenRouter é o único provider na UI e no backend.
- [ ] Admin consegue inputar chave OpenRouter e escolher modelo pelo painel.
- [ ] `make lint && make typecheck && make test` verdes.
- [ ] Smoke test E2E contra staging (seção 7) com evidência registrada.
- [ ] PR mergeado em `main` e deploy staging verde.
- [ ] Comentário de encerramento na issue/report para o Edu.
