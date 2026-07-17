# Mike — Suite Completa de Testes QA

**Plataforma:** Mike (Atlas Governance)  
**Ambiente:** https://mike.agov.app (Staging)  
**Data:** 16 de Julho de 2026  
**Responsável pela execução:** _[preencher]_  
**Modelo LLM ativo:** DeepSeek V4 Pro (única API key configurada via env)

---

## Como usar este documento

Cada teste tem um ID único (ex: `AUTH-01`), prioridade (P0/P1/P2), pré-requisitos, passos e resultado esperado. Ao final de cada teste, registre:

- **Status:** ✅ Passou / ❌ Falhou / ⚠️ Parcial / ⏭️ Skipado
- **Evidência:** Print, vídeo, ou descrição do comportamento observado
- **Notas:** Qualquer observação relevante

**Legenda de prioridade:**
- **P0 — Crítico:** Bloqueia uso principal da plataforma
- **P1 — Alto:** Afeta experiência do usuário significativamente
- **P2 — Médio:** Inconveniente mas não bloqueia
- **P3 — Baixo:** Cosmético ou edge case raro

**Credenciais de teste:** Usar a conta de staging fornecida pela equipe.

---

# 1. Autenticação e Sessão

## AUTH-01 — Login com credenciais válidas (P0)
**Pré-requisitos:** Conta ativa no staging  
**Passos:**
1. Acessar https://mike.agov.app
2. Inserir email e senha válidos
3. Clicar em "Entrar"
**Esperado:** Redirecionamento para a página principal (Assistant ou Dashboard). Usuário aparece logado no canto superior.

## AUTH-02 — Login com senha incorreta (P0)
**Pré-requisitos:** Conta ativa  
**Passos:**
1. Acessar a tela de login
2. Inserir email válido e senha incorreta
3. Clicar em "Entrar"
**Esperado:** Mensagem de erro clara ("Invalid login credentials" ou similar). Não redireciona.

## AUTH-03 — Login com email inexistente (P1)
**Passos:**
1. Inserir email não cadastrado (ex: `naoexiste@teste.com`)
2. Inserir qualquer senha
3. Clicar em "Entrar"
**Esperado:** Mensagem de erro. Não revela se o email existe ou não.

## AUTH-04 — Logout (P0)
**Pré-requisitos:** Logado  
**Passos:**
1. Clicar no avatar/menu do usuário
2. Selecionar "Logout" ou "Sair"
**Esperado:** Redirecionamento para tela de login. Token invalidado. Ao acessar URL interna diretamente, redireciona para login.

## AUTH-05 — Acesso a rota protegida sem login (P0)
**Passos:**
1. Deslogar
2. Acessar diretamente: `https://mike.agov.app/assistant`
3. Acessar: `https://mike.agov.app/projects`
4. Acessar: `https://mike.agov.app/tabular-reviews`
**Esperado:** Redirecionamento para tela de login em todos os casos.

## AUTH-06 — Persistência de sessão ao recarregar (P0)
**Pré-requisitos:** Logado  
**Passos:**
1. Estar em qualquer página interna
2. Recarregar a página (F5 / Cmd+R)
**Esperado:** Permanece logado. Página recarrega sem redirecionar para login.

## AUTH-07 — Expiração de sessão (P1)
**Pré-requisitos:** Logado  
**Passos:**
1. Anotar a hora do login
2. Aguardar 60+ minutos sem atividade
3. Tentar enviar uma mensagem no chat ou executar uma ação
**Esperado:** Se a sessão expirou, o sistema deve redirecionar para login ou mostrar mensagem de sessão expirada. Não deve mostrar erro genérico "Algo deu errado".

## AUTH-08 — Múltiplas abas na mesma sessão (P1)
**Pré-requisitos:** Logado  
**Passos:**
1. Abrir o Mike em uma aba
2. Abrir o Mike em uma segunda aba
3. Interagir em ambas (enviar mensagem em uma, navegar na outra)
**Esperado:** Ambas funcionam. Sem conflito de sessão ou erro.

---

# 2. Gestão de Documentos (Single Documents)

## DOC-01 — Upload de arquivo PDF (P0)
**Pré-requisitos:** Logado  
**Passos:**
1. Ir para "Documents" ou acessar via Assistant → anexar documento
2. Clicar em "Add Documents" ou "Upload"
3. Selecionar um arquivo PDF (ex: contrato, petição)
4. Aguardar upload
**Esperado:**
- Upload completa sem erro
- Documento aparece na lista
- Status do documento muda para "ready" ou similar
- Nome do arquivo é exibido corretamente

## DOC-02 — Upload de arquivo DOCX (P0)
**Passos:** Mesmo que DOC-01 mas com arquivo .docx  
**Esperado:** Mesmo que DOC-01. Documento é processado (conversão via LibreOffice).

## DOC-03 — Upload de arquivo grande (>10MB) (P1)
**Passos:**
1. Fazer upload de um PDF com mais de 10MB
**Esperado:** Upload completa dentro de 60 segundos. Se demorar mais, deve mostrar indicador de progresso ou mensagem "Processando...".

## DOC-04 — Upload de formato não suportado (P1)
**Passos:**
1. Tentar fazer upload de arquivo .txt, .jpg, .xlsx ou .zip
**Esperado:** Sistema rejeita o arquivo com mensagem clara ("Formato não suportado" ou similar). Não crasha.

## DOC-05 — Upload de múltiplos arquivos simultâneos (P1)
**Passos:**
1. Selecionar 3+ arquivos PDF de uma vez
2. Confirmar upload
**Esperado:** Todos os arquivos são carregados. Lista atualizada com todos os documentos.

## DOC-06 — Listar documentos (P0)
**Pré-requisitos:** Pelo menos 1 documento cadastrado  
**Passos:**
1. Ir para a página de Documents
**Esperado:** Lista mostra todos os documentos do usuário com: nome, data de upload, status.

## DOC-07 — Visualizar conteúdo de documento (P0)
**Pré-requisitos:** Documento processado/ready  
**Passos:**
1. Clicar em um documento da lista
**Esperado:** Conteúdo do documento é exibido (texto extraído ou preview do PDF). Layout legível.

## DOC-08 — Baixar documento original (P1)
**Passos:**
1. Na lista de documentos, clicar em "Download" ou no ícone de download
**Esperado:** Arquivo original (PDF/DOCX) é baixado no computador.

## DOC-09 — Deletar documento (P1)
**Pré-requisitos:** Documento que não está em uso em nenhum chat/review  
**Passos:**
1. Selecionar um documento
2. Clicar em "Delete" ou ícone de lixeira
3. Confirmar exclusão
**Esperado:** Documento removido da lista. Não aparece mais em listas de seleção de documentos.

## DOC-10 — Download em lote (ZIP) (P2)
**Pré-requisitos:** 2+ documentos cadastrados  
**Passos:**
1. Selecionar múltiplos documentos
2. Clicar em "Download ZIP" ou similar
**Esperado:** Arquivo .zip é baixado contendo todos os documentos selecionados.

## DOC-11 — Atualização da lista após upload (P0)
**Pré-requisitos:** Estar na página de Documents  
**Passos:**
1. Fazer upload de um novo documento
2. Observar se a lista atualiza automaticamente
**Esperado:** O novo documento aparece na lista **sem precisar recarregar a página**. Se não aparecer automaticamente, é um bug conhecido — reportar.

## DOC-12 — Upload de arquivo corrompido (P2)
**Passos:**
1. Criar um arquivo PDF corrompido (renomear um .txt para .pdf)
2. Tentar fazer upload
**Esperado:** Sistema mostra erro de processamento. Não crasha nem trava em loop.

---

# 3. Assistant (Chat Geral)

## CHAT-01 — Criar novo chat (P0)
**Pré-requisitos:** Logado  
**Passos:**
1. Ir para "Assistant"
2. Digitar uma pergunta simples (ex: "Olá, o que você pode fazer?")
3. Pressionar Enter ou clicar em enviar
**Esperado:**
- Novo chat é criado
- Mensagem do usuário aparece no chat
- Resposta da IA é streamada (aparece palavra por palavra)
- Título do chat é gerado automaticamente ou mostra "New Chat"

## CHAT-02 — Enviar mensagem sem documento anexado (P0)
**Passos:**
1. Em um chat existente, digitar uma pergunta jurídica genérica
2. Enviar
**Esperado:** IA responde adequadamente. Resposta é streamada via SSE.

## CHAT-03 — Anexar documento e fazer pergunta sobre ele (P0)
**Pré-requisitos:** Pelo menos 1 documento cadastrado  
**Passos:**
1. Em um chat, clicar no botão de anexar documento (clipe ou "Add")
2. Selecionar um documento da lista
3. Digitar: "Resuma este documento"
4. Enviar
**Esperado:**
- Documento aparece anexado à mensagem
- IA responde com base no conteúdo do documento
- Resposta inclui **citações** que referenciam o documento (clique na citação leva ao trecho)

## CHAT-04 — Segundo prompt mantendo contexto do documento (P0)
**Pré-requisitos:** CHAT-03 concluído  
**Passos:**
1. No mesmo chat, enviar uma segunda pergunta referenciando o documento (ex: "Quais são as partes envolvidas?")
2. Aguardar resposta
**Esperado:**
- IA responde mantendo o contexto do documento anexado no prompt anterior
- **NÃO** deve aparecer erro "Algo deu errado"
- **NÃO** deve dizer que o documento não está disponível
- Citações continuam funcionando

## CHAT-05 — Terceiro e quarto prompts consecutivos (P1)
**Pré-requisitos:** CHAT-04 concluído  
**Passos:**
1. Enviar mais 2 perguntas no mesmo chat, fazendo follow-ups
2. Verificar se a IA mantém contexto de toda a conversa
**Esperado:** IA mantém contexto da conversa inteira. Sem perda de memória entre mensagens.

## CHAT-06 — Seleção de modelo (P1)
**Pré-requisitos:** Logado  
**Passos:**
1. Abrir um chat
2. Clicar no seletor de modelo (canto inferior)
3. Verificar modelos disponíveis
4. Confirmar que "DeepSeek V4 Pro" está selecionável e **não** mostra alerta de "API key missing"
**Esperado:**
- DeepSeek V4 Pro aparece como disponível (sem ícone de erro vermelho)
- Selecionar outro modelo (se houver) funciona
- Ao enviar mensagem, o modelo selecionado é usado

## CHAT-07 — Anexar múltiplos documentos (P1)
**Pré-requisitos:** 2+ documentos cadastrados  
**Passos:**
1. Anexar 2 ou 3 documentos ao mesmo prompt
2. Perguntar: "Compare os documentos anexados"
3. Enviar
**Esperado:** IA analisa todos os documentos. Citações referenciam os diferentes documentos.

## CHAT-08 — Listar chats anteriores (P0)
**Pré-requisitos:** 2+ chats criados  
**Passos:**
1. Ir para "Assistant"
2. Verificar sidebar ou lista de chats
**Esperado:** Todos os chats anteriores aparecem na lista com título (gerado ou manual).

## CHAT-09 — Abrir chat existente (P0)
**Passos:**
1. Clicar em um chat anterior na lista
**Esperado:** Histórico de mensagens carrega corretamente. Todas as mensagens (user + assistant) aparecem na ordem correta.

## CHAT-10 — Editar título do chat (P2)
**Passos:**
1. Abrir um chat
2. Editar o título (se a UI permitir)
**Esperado:** Título é atualizado e persiste ao recarregar.

## CHAT-11 — Deletar chat (P1)
**Passos:**
1. Selecionar um chat na lista
2. Deletar (botão/lixeira)
3. Confirmar
**Esperado:** Chat removido da lista. Mensagens associadas não aparecem mais.

## CHAT-12 — Chat com pergunta vazia (P2)
**Passos:**
1. Deixar o campo de mensagem vazio
2. Tentar enviar (Enter ou botão)
**Esperado:** Botão de envio fica desabilitado ou mostra validação. Não envia mensagem vazia.

## CHAT-13 — Chat com texto muito longo (P2)
**Passos:**
1. Colar um texto muito longo (5000+ caracteres) no campo de mensagem
2. Enviar
**Esperado:** Mensagem é enviada ou mostra limite de caracteres. Não crasha o input.

## CHAT-14 — Streaming de resposta não interrompe (P1)
**Passos:**
1. Enviar uma pergunta que gere uma resposta longa
2. Durante o streaming, observar se a resposta para ou trava
**Esperado:** Resposta é streamada continuamente até completar. Sem truncamento ou timeout.

## CHAT-15 — Citações funcionam (P0)
**Pré-requisitos:** Chat com documento anexado e resposta com citações  
**Passos:**
1. Clicar em uma citação na resposta da IA
**Esperado:** Abre ou destaca o trecho correspondente no documento. Número da página ou seção é mostrado.

## CHAT-16 — Copiar resposta (P2)
**Passos:**
1. Hover sobre uma resposta da IA
2. Clicar em "Copy" ou ícone de cópia (se disponível)
**Esperado:** Texto da resposta é copiado para a área de transferência.

---

# 4. Projetos

## PROJ-01 — Criar novo projeto (P0)
**Passos:**
1. Ir para "Projects"
2. Clicar em "New Project" ou similar
3. Preencher nome (ex: "Projeto de Teste QA")
4. Confirmar
**Esperado:** Projeto criado. Aparece na lista de projetos. Redireciona para a página do projeto.

## PROJ-02 — Listar projetos (P0)
**Pré-requisitos:** 1+ projeto criado  
**Passos:**
1. Ir para "Projects"
**Esperado:** Lista mostra todos os projetos do usuário com nome e data de criação.

## PROJ-03 — Abrir projeto existente (P0)
**Passos:**
1. Clicar em um projeto da lista
**Esperado:** Página do projeto abre. Mostra tabs/seções: Documents, Assistant, Tabular Reviews, etc.

## PROJ-04 — Editar nome do projeto (P2)
**Passos:**
1. Abrir um projeto
2. Editar o nome
3. Salvar
**Esperado:** Nome atualizado. Persiste ao recarregar.

## PROJ-05 — Deletar projeto (P1)
**Passos:**
1. Selecionar um projeto
2. Deletar
3. Confirmar
**Esperado:** Projeto removido da lista. Documentos e chats associados não aparecem mais.

## PROJ-06 — Upload de documento dentro de projeto (P0)
**Pré-requisitos:** Projeto criado  
**Passos:**
1. Abrir o projeto
2. Ir para a aba Documents
3. Fazer upload de um PDF
**Esperado:** Documento é salvo e associado ao projeto. Aparece na lista de documentos do projeto.

## PROJ-07 — Chat dentro de projeto (P0)
**Pré-requisitos:** Projeto com documento  
**Passos:**
1. Abrir o projeto
2. Ir para a aba Assistant/Chat
3. Criar um novo chat
4. Anexar documento do projeto
5. Fazer uma pergunta sobre o documento
6. Enviar um segundo prompt (follow-up)
**Esperado:**
- Chat é criado dentro do contexto do projeto
- Documentos do projeto estão disponíveis para anexar
- Segundo prompt mantém contexto (sem erro "Algo deu errado")

## PROJ-08 — Deletar documento de projeto (P1)
**Passos:**
1. Abrir projeto → Documents
2. Deletar um documento
**Esperado:** Documento removido do projeto. Não aparece mais na lista do projeto.

## PROJ-09 — Criar pastas/folders no projeto (P2)
**Passos:**
1. Abrir projeto → Documents
2. Criar uma nova pasta (se disponível)
3. Mover um documento para a pasta
**Esperado:** Pasta criada. Documento movido. Estrutura de pastas persiste.

---

# 5. Tabular Review

## TR-01 — Criar nova Tabular Review (P0)
**Passos:**
1. Ir para "Tabular Reviews" (ou dentro de um projeto)
2. Clicar em "New Tabular Review" ou similar
3. Preencher título (ex: "Análise de Contratos")
4. Confirmar criação
**Esperado:** Tabular Review criada. Redireciona para a página de edição.

## TR-02 — Adicionar documentos à Tabular Review (P0)
**Pré-requisitos:** TR criada, 1+ documento cadastrado  
**Passos:**
1. Abrir a Tabular Review
2. Clicar em "Add Documents"
3. Selecionar 1 ou mais documentos
4. Confirmar
**Esperado:** Documentos adicionados à review. Aparecem na lista de documentos da review.

## TR-03 — Adicionar/editar colunas (P0)
**Pré-requisitos:** TR criada  
**Passos:**
1. Na Tabular Review, adicionar colunas (ex: "Partes", "Valor", "Vigência", "Objeto")
2. Salvar configuração de colunas
**Esperado:** Colunas aparecem no header da tabela. Persistem ao recarregar.

## TR-04 — Botão RUN — geração de células (P0)
**Pré-requisitos:** TR com documentos E colunas adicionadas  
**Passos:**
1. Verificar que o botão "Run" está **ativo** (não cinza/disabled)
2. Clicar em "Run"
3. Aguardar processamento
**Esperado:**
- Botão Run está clicável (não disabled)
- Ao clicar, inicia geração via LLM
- Células são preenchidas com dados extraídos dos documentos
- Se houver erro, aparece mensagem visível (banner vermelho) — não falha silenciosamente
- Geração completa para todos os documentos × colunas

## TR-05 — Botão RUN sem documentos (P1)
**Pré-requisitos:** TR criada sem documentos  
**Passos:**
1. Adicionar colunas mas NÃO adicionar documentos
2. Verificar o botão Run
**Esperado:** Botão Run fica desabilitado ou mostra mensagem "Adicione documentos primeiro".

## TR-06 — Botão RUN sem colunas (P1)
**Pré-requisitos:** TR criada sem colunas  
**Passos:**
1. Adicionar documentos mas NÃO adicionar colunas
2. Verificar o botão Run
**Esperado:** Botão Run fica desabilitado ou mostra mensagem "Adicione colunas primeiro".

## TR-07 — Editar célula manualmente (P1)
**Pré-requisitos:** TR com células geradas  
**Passos:**
1. Clicar em uma célula da tabela
2. Editar o texto
3. Salvar/clicar fora
**Esperado:** Célula é editada. Alteração persiste ao recarregar.

## TR-08 — Limpar células (P2)
**Pré-requisitos:** TR com células geradas  
**Passos:**
1. Clicar em "Clear Cells" ou similar
2. Confirmar
**Esperado:** Todas as células são limpas. Colunas e documentos permanecem.

## TR-09 — Chat lateral da Tabular Review (P1)
**Pré-requisitos:** TR com documentos  
**Passos:**
1. Abrir o painel de chat lateral da Tabular Review
2. Fazer uma pergunta sobre os documentos da review
3. Enviar
4. Enviar um segundo prompt (follow-up)
**Esperado:**
- Chat responde com base nos documentos da review
- Segundo prompt mantém contexto
- Sem erro "Algo deu errado"

## TR-10 — Sugerir colunas via IA (P2)
**Pré-requisitos:** TR com documentos  
**Passos:**
1. Usar a função de "Suggest Columns" ou prompt para sugerir colunas (se disponível)
**Esperado:** IA sugere colunas relevantes baseadas nos documentos. Colunas sugeridas podem ser adicionadas.

## TR-11 — Exportar Tabular Review (P1)
**Pré-requisitos:** TR com células preenchidas  
**Passos:**
1. Clicar em "Export" ou "Download"
2. Escolher formato (CSV, XLSX, ou PDF se disponível)
**Esperado:** Arquivo é baixado com o conteúdo da tabela. Dados estão corretos e formatados.

## TR-12 — Deletar Tabular Review (P1)
**Passos:**
1. Ir para lista de Tabular Reviews
2. Deletar uma review
3. Confirmar
**Esperado:** Review removida da lista.

## TR-13 — Tabular Review dentro de projeto (P1)
**Pré-requisitos:** Projeto criado  
**Passos:**
1. Abrir projeto
2. Ir para aba Tabular Reviews
3. Criar nova TR dentro do projeto
4. Adicionar documentos do projeto
5. Adicionar colunas
6. Clicar Run
**Esperado:** Funciona igual a TR standalone. Documentos do projeto estão disponíveis.

## TR-14 — Re-run após editar colunas (P1)
**Pré-requisitos:** TR com células já geradas  
**Passos:**
1. Adicionar uma nova coluna
2. Clicar Run novamente
**Esperado:** Apenas as células novas/empty são geradas (ou todas regeneradas, dependendo do comportamento esperado). Não duplica células existentes.

## TR-15 — Tabular Review com múltiplos documentos (P1)
**Pré-requisitos:** 3+ documentos  
**Passos:**
1. Criar TR com 3+ documentos
2. Adicionar 4+ colunas
3. Clicar Run
**Esperado:** Tabela gerada com uma linha por documento e uma coluna por campo. Todas as células preenchidas (ou marcadas como "N/A" se não aplicável).

---

# 6. Workflows

## WF-01 — Listar workflows disponíveis (P1)
**Passos:**
1. Ir para "Workflows"
**Esperado:** Lista de workflows disponíveis é exibida (se houver).

## WF-02 — Criar novo workflow (P2)
**Passos:**
1. Clicar em "New Workflow"
2. Definir nome e configurações
3. Salvar
**Esperado:** Workflow criado e aparece na lista.

## WF-03 — Editar workflow (P2)
**Passos:**
1. Abrir um workflow existente
2. Modificar etapas ou prompt
3. Salvar
**Esperado:** Alterações persistem.

## WF-04 — Deletar workflow (P2)
**Passos:**
1. Deletar um workflow
2. Confirmar
**Esperado:** Workflow removido.

## WF-05 — Executar workflow no chat (P2)
**Pré-requisitos:** Workflow criado  
**Passos:**
1. Abrir Assistant
2. Selecionar um workflow (se disponível no chat input)
3. Enviar mensagem
**Esperado:** Workflow é executado. Resposta segue o template/etapas do workflow.

---

# 7. Conta e Perfil

## ACC-01 — Visualizar perfil (P0)
**Passos:**
1. Ir para "Account" ou clicar no avatar
**Esperado:** Página de perfil mostra: nome, organização, tier/plan, créditos.

## ACC-02 — Editar nome de exibição (P1)
**Passos:**
1. Ir para Account
2. Editar "Display Name"
3. Salvar
**Esperado:** Nome atualizado. Persiste ao recarregar. Aparece no header/avatar.

## ACC-03 — Editar organização (P2)
**Passos:**
1. Ir para Account
2. Editar "Organisation"
3. Salvar
**Esperado:** Organização atualizada e persiste.

## ACC-04 — Visualizar e alterar modelos padrão (P1)
**Passos:**
1. Ir para Account → Models (ou similar)
2. Verificar modelo de título (titleModel) e modelo tabular (tabularModel)
3. Alterar um dos modelos
4. Salvar
**Esperado:**
- Modelos atuais são exibidos corretamente
- DeepSeek V4 Pro e DeepSeek V4 Flash aparecem como opções
- Nenhum modelo mostra "API key missing" (já que DeepSeek está configurado via env)
- Alteração persiste ao recarregar

## ACC-05 — Visualizar status de API Keys (P1)
**Passos:**
1. Ir para Account → API Keys
**Esperado:**
- DeepSeek aparece como configurado (via env/servidor)
- Outros providers (OpenAI, Claude, Gemini) aparecem como não configurados
- Não é possível editar DeepSeek (configurado pelo servidor)
- Campo de input para outros providers está disponível

## ACC-06 — Adicionar API key de outro provider (P2)
**Passos:**
1. Ir para Account → API Keys
2. Inserir uma API key para OpenAI (pode ser fake para teste)
3. Salvar
**Esperado:** Key é salva (criptografada). Aparece como configurada. Modelo correspondente fica disponível no chat.

## ACC-07 — Remover API key de provider (P2)
**Pré-requisitos:** ACC-06 concluído  
**Passos:**
1. Remover a API key adicionada
**Esperado:** Key removida. Provider volta a não configurado.

## ACC-08 — Página de Segurança (P2)
**Passos:**
1. Ir para Account → Security
**Esperado:** Página carrega. Mostra opções de MFA/2FA se disponível.

## ACC-09 — Página de Privacidade e Dados (P2)
**Passos:**
1. Ir para Account → Privacy & Data
**Esperado:** Página carrega. Mostra opções de exportação/exclusão de dados se disponível.

---

# 8. Navegação e UI

## NAV-01 — Navegação entre páginas principais (P0)
**Passos:**
1. A partir da home, navegar para: Assistant → Projects → Tabular Reviews → Account
2. Voltar para cada uma usando o botão "Voltar" do browser
**Esperado:** Todas as páginas carregam corretamente. Botão voltar funciona sem erro.

## NAV-02 — Sidebar/Menu de navegação (P0)
**Passos:**
1. Verificar que a sidebar/menu está visível em todas as páginas internas
2. Clicar em cada item do menu
**Esperado:** Cada item navega para a página correta. Item ativo é destacado.

## NAV-03 — Responsividade — mobile/tablet (P2)
**Passos:**
1. Redimensionar a janela para 768px (tablet) e 375px (mobile)
2. Navegar pelas principais páginas
**Esperado:** Layout se adapta. Menu colapsa se necessário. Texto permanece legível. Botões permanecem clicáveis.

## NAV-04 — Página 404 (P2)
**Passos:**
1. Acessar URL inexistente: `https://mike.agov.app/pagina-que-nao-existe`
**Esperado:** Página 404 amigável. Link para voltar à home.

## NAV-05 — Página de erro genérico (P1)
**Passos:**
1. Provocar um erro (ex: tentar acessar recurso que não pertence ao usuário)
**Esperado:** Página de erro amigável com botão "Home". Não mostra stack trace ou erro técnico.

## NAV-06 — Breadcrumbs (P2)
**Passos:**
1. Navegar: Projects → [Projeto] → Tabular Reviews → [Review]
2. Verificar breadcrumbs
**Esperado:** Breadcrumbs mostram o caminho. Clicar em um nível anterior navega corretamente.

## NAV-07 — Dark mode (se disponível) (P3)
**Passos:**
1. Alternar entre light/dark mode (se houver toggle)
**Esperado:** Todas as páginas respeitam o tema. Texto legível em ambos os modos.

---

# 9. Performance e Confiabilidade

## PERF-01 — Tempo de carregamento inicial (P1)
**Passos:**
1. Deslogar e limpar cache
2. Acessar https://mike.agov.app (tela de login)
3. Medir tempo até a página estar interativa
**Esperado:** Página de login carrega em menos de 3 segundos.

## PERF-02 — Tempo de carregamento pós-login (P1)
**Passos:**
1. Fazer login
2. Medir tempo até a primeira página (Assistant/Dashboard) estar interativa
**Esperado:** Carrega em menos de 5 segundos.

## PERF-03 — Latência do chat (P1)
**Pré-requisitos:** Logado, chat aberto  
**Passos:**
1. Enviar uma pergunta simples
2. Medir tempo até primeiro token da resposta aparecer (TTFT — Time To First Token)
3. Medir tempo até resposta completa
**Esperado:** Primeiro token em menos de 5 segundos. Resposta completa em menos de 30 segundos (depende do tamanho).

## PERF-04 — Latência do Tabular Review Generate (P1)
**Pré-requisitos:** TR com 2 documentos e 3 colunas  
**Passos:**
1. Clicar em Run
2. Medir tempo até conclusão
**Esperado:** Geração completa em menos de 2 minutos. Se demorar mais, deve mostrar indicador de progresso.

## PERF-05 — Upload de documento — tempo (P1)
**Passos:**
1. Fazer upload de um PDF de 2-5MB
2. Medir tempo até o documento estar "ready"
**Esperado:** Upload + processamento em menos de 30 segundos.

## PERF-06 — Comportamento sob carga — múltiplas ações (P2)
**Passos:**
1. Abrir 3 chats em 3 abas
2. Enviar mensagens simultaneamente nas 3
**Esperado:** Todas as respostas chegam. Sem timeout ou erro.

## PERF-07 — Reconexão após perda de rede (P1)
**Passos:**
1. Estar em um chat ativo
2. Desligar Wi-Fi/redes
3. Aguardar 10 segundos
4. Ligar a rede novamente
5. Tentar enviar uma mensagem
**Esperado:** Sistema se recupera. Mensagem é enviada. Se a sessão expirou, redireciona para login (não erro genérico).

---

# 10. Edge Cases e Casos Limite

## EDGE-01 — Anexar e remover documento antes de enviar (P2)
**Passos:**
1. No chat, anexar um documento
2. Remover o documento anexado (X ou remove)
3. Enviar mensagem sem documento
**Esperado:** Mensagem enviada sem documento. IA responde como chat normal.

## EDGE-02 — Trocar modelo durante conversa (P2)
**Passos:**
1. Enviar 2 mensagens com DeepSeek V4 Pro
2. Trocar para outro modelo (se disponível)
3. Enviar mais uma mensagem
**Esperado:** Terceira mensagem usa o novo modelo. Contexto da conversa é mantido.

## EDGE-03 — Enviar mensagem enquanto IA está respondendo (P2)
**Passos:**
1. Enviar uma pergunta
2. Enquanto a IA está streamando, tentar enviar outra
**Esperado:** Input é bloqueado ou enfileirado. Não envia múltiplas requisições simultâneas.

## EDGE-04 — Caracteres especiais e emojis (P2)
**Passos:**
1. Enviar mensagem com: "Análise do § 3º do art. 5º 📄 — Ção & Número"
2. Verificar se a mensagem é processada corretamente
**Esperado:** Caracteres especiais, acentos e emojis são preservados. IA responde normalmente.

## EDGE-05 — Nome de projeto/documento muito longo (P3)
**Passos:**
1. Criar projeto com nome de 200+ caracteres
2. Verificar exibição na lista e no header
**Esperado:** Nome é truncado com ellipsis (...) ou quebra de linha. Layout não quebra.

## EDGE-06 — Tabular Review com documento sem texto extraível (P2)
**Pré-requisitos:** PDF de imagem escaneada (sem OCR)  
**Passos:**
1. Criar TR com documento sem texto
2. Adicionar colunas
3. Clicar Run
**Esperado:** Sistema lida graciosamente — célula mostra "N/A" ou "No text found". Não crasha.

## EDGE-07 — Acessar Tabular Review de outro usuário (P1)
**Passos:**
1. Copiar o ID de uma TR de outra conta (se acessível)
2. Tentar acessar via URL: `/tabular-reviews/[id-alheio]`
**Esperado:** Erro 403/404. Não mostra dados de outro usuário.

## EDGE-08 — Deletar documento em uso em Tabular Review (P1)
**Pré-requisitos:** TR com documento e células geradas  
**Passos:**
1. Ir para Documents e deletar o documento usado na TR
2. Abrir a TR novamente
**Esperado:** TR mostra o documento como "deleted" ou remove a linha. Não crasha ao tentar re-run.

## EDGE-09 — Upload de arquivo com nome duplicado (P3)
**Passos:**
1. Fazer upload de "contrato.pdf"
2. Fazer upload de outro arquivo também chamado "contrato.pdf"
**Esperado:** Ambos são aceitos (com sufixo ou sem conflito). Não sobrescreve o primeiro.

## EDGE-10 — Navegação por URL direta em chat existente (P1)
**Pré-requisitos:** Chat criado  
**Passos:**
1. Copiar a URL do chat atual
2. Abrir em nova aba
**Esperado:** Chat carrega diretamente com todo o histórico.

---

# 11. Segurança (Testes Básicos)

## SEC-01 — Token não exposto em URL (P0)
**Passos:**
1. Fazer login
2. Inspecionar a URL do browser
3. Verificar Network → Headers nas DevTools
**Esperado:** Token JWT não aparece na URL. Está no header Authorization (Bearer).

## SEC-02 — Isolamento entre usuários — documentos (P0)
**Passos:**
1. Logar como Usuário A, fazer upload de documento
2. Logar como Usuário B (ou conta diferente)
3. Listar documentos
**Esperado:** Usuário B não vê documentos do Usuário A.

## SEC-03 — Isolamento entre usuários — chats (P0)
**Passos:**
1. Logar como Usuário A, criar chat
2. Logar como Usuário B
3. Listar chats
**Esperado:** Usuário B não vê chats do Usuário A.

## SEC-04 — API Keys não são exibidas em texto plano (P0)
**Pré-requisitos:** API key cadastrada  
**Passos:**
1. Ir para Account → API Keys
2. Verificar como a key é exibida
**Esperado:** Apenas últimos 4 caracteres são mostrados (ex: `****...abcd`). Nunca a key completa.

## SEC-05 — Logout invalida token (P0)
**Passos:**
1. Fazer login
2. Anotar o token (via DevTools → Network)
3. Fazer logout
4. Tentar usar o token antigo em uma requisição curl/API
**Esperado:** Token rejeitado (401). Não é possível acessar recursos após logout.

---

# 12. Casos de Regressão (Bugs já corrigidos)

Estes testes verificam especificamente bugs que foram corrigidos e não devem voltar.

## REG-01 — Segundo prompt no chat sem erro (P0)
**Pré-requisitos:** Chat com documento anexado, primeiro prompt enviado  
**Passos:**
1. Enviar segundo prompt no mesmo chat, fazendo referência ao documento
2. Verificar resposta
**Esperado:** IA responde mantendo contexto do documento. **NÃO** deve aparecer "Algo deu errado". **NÃO** deve dizer que o documento não está mais disponível.

## REG-02 — Botão Run da Tabular Review ativo (P0)
**Pré-requisitos:** TR com documentos e colunas  
**Passos:**
1. Abrir TR
2. Verificar se botão Run está ativo (clicável)
3. Clicar em Run
**Esperado:** Botão está ativo. Geração inicia. **NÃO** deve estar disabled sem motivo.

## REG-03 — DeepSeek V4 Pro sem "API key missing" (P0)
**Pré-requisitos:** Logado  
**Passos:**
1. Abrir Assistant
2. Verificar o seletor de modelo
3. Confirmar que DeepSeek V4 Pro está selecionado por padrão
4. Verificar se há ícone vermelho de alerta
**Esperado:** DeepSeek V4 Pro está selecionado. **Sem** ícone de alerta vermelho. **Sem** mensagem "API key missing".

## REG-04 — Tabular Review Generate com DeepSeek (P0)
**Pré-requisitos:** TR com documentos e colunas  
**Passos:**
1. Clicar Run
2. Aguardar geração
**Esperado:** Células são geradas corretamente usando DeepSeek. **NÃO** deve retornar erro de "missing_api_key" ou "gemini".

## REG-05 — User messages persistem no banco (P1)
**Pré-requisitos:** Chat com 2+ mensagens  
**Passos:**
1. Enviar 2 mensagens no chat
2. Recarregar a página
3. Verificar se ambas as mensagens (user + assistant) aparecem
**Esperado:** Todas as mensagens aparecem após recarregar, incluindo as do usuário. Se mensagens do usuário somem, é regressão do bug da coluna `workflow`.

---

# Resumo de Execução

Ao final, preencher a tabela abaixo:

**Total de testes:** 95  
**Passaram:** _[X]_  
**Falharam:** _[X]_  
**Parciais:** _[X]_  
**Skipados:** _[X]_

**Bugs críticos encontrados (P0):**
1. _[descrever]_
2. _[descrever]_
3. _[descrever]_

**Bugs altos encontrados (P1):**
1. _[descrever]_
2. _[descrever]_

**Observações gerais:**
_[descrever]_

---

*Documento gerado por: Mimosa Malpassada (QA Engineer, Atlas Governance)*  
*Última atualização: 16 de Julho de 2026*
