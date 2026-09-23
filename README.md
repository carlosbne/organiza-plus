# Organiza+ — Protótipo

Protótipo local, simples e minimalista para a rotina de Departamento Pessoal. Foi construído sem frameworks e sem dependências de produção para consumir poucos recursos.

## Recursos

- Gestão de tarefas com prazo, empresa, prioridade, observações, filtros e indicadores.
- Persistência local no navegador e sincronização opcional com Supabase por usuário autenticado.
- Calculadora de horas extras, adicional noturno com hora reduzida e DSR.
- Simulador mensal de custo de contratação por regime tributário.
- Simulador estimativo de rescisão contratual para contrato por prazo indeterminado.
- Manual de dúvidas frequentes, FGTS Digital, rescisão e seguro-desemprego.
- Layout responsivo e navegação por teclado.

## Como abrir no Windows

Dê dois cliques em `iniciar-organiza-plus.bat`. O sistema abrirá em:

`http://127.0.0.1:4173`

Alternativamente, no terminal:

```bash
npm run serve
```

O servidor (`scripts/serve.mjs`) resolve as rotas sem extensão (`/status`, `/admin`, `/auth`, `/consultas`) para os `.html` correspondentes, igual ao `netlify.toml`. Para testar o build:

```bash
npm run build
npm run serve:dist   # serve dist/ em http://127.0.0.1:4174
```

As consultas ficam disponíveis em [`/consultas`](./consultas.html), separadas do fluxo principal. O simulador de rescisão fica em **Ferramentas**.

## Fluxo de aprovação de contas

Todo novo cadastro nasce com status **pendente** (tabela `public.profiles`) e só tem acesso após **aprovação manual de um administrador** em `/admin`. Usuários rejeitados ficam **bloqueados** até o admin reabrir o cadastro na fila.

- **Status:** `pending` → `approved` | `blocked`. Rejeição tem motivo opcional (máx. 500 caracteres); reabrir devolve para a fila.
- **Papéis:** `user`/`admin`. O primeiro admin é definido pela migration (tabela `bootstrap_admins`, com os e-mails já cadastrados). O admin não gerencia papéis nesta versão.
- **Tela de status:** `/status` mostra "cadastro em análise", o motivo da rejeição quando existir, ou falha fechada se não houver confirmação.
- **Segurança:** RLS de `tasks` exige conta aprovada; RPCs `SECURITY DEFINER` com `search_path` fixo; acesso aos perfis do cliente somente via RPC; `revoke` de grants para `anon`/`authenticated`; localStorage de tarefas isolado por usuário (`organizaPlus.tasks.v3:<user_id>`) e limpo no logout.

**Pré-requisito obrigatório (produção e dev):** habilite a **confirmação de e-mail** no Supabase (Authentication → Sign In/Providers → "Confirm email", equivalente a `[auth.email] enable_confirmations = true` no `config.toml`). A promoção a admin pelo bootstrap e o primeiro acesso exigem e-mail confirmado — sem isso, qualquer pessoa poderia criar conta com o e-mail de um admin listado na migration e ganhar privilégio.

**Para aplicar as migrations do banco:**

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

## Testes

```bash
npm test
npm run test:security
node tests/smoke-dist.mjs   # smoke do build (requer Chrome; usa o servidor real)
npm run test:flow           # e2e do fluxo de aprovação (requer Chrome; não precisa de Supabase)
```

O teste de fluxo (`tests/approval-flow.e2e.mjs`) simula o ciclo completo **com o app real** (build servido localmente, dirigido via Chrome headless): signup → pendente sem acesso (inclusive 403 na API de tarefas) → admin aprova/rejeita com motivo → aprovado acessa e cria tarefa → rejeitado vê o motivo — reabertura volta para a fila, histórico e guarda de acesso. Ele usa o `scripts/mock-supabase.mjs`, que reproduz as mesmas regras da migration (estados, RLS, checagem de admin) — por isso roda sem Docker/Supabase.

O teste de ponta a ponta (`tests/e2e.mjs`) usa o Chrome via DevTools e foi executado durante a entrega.

## Privacidade e segurança

- Sem configuração, os dados das tarefas ficam no `localStorage` do navegador.
- Para persistência compartilhada, configure `SUPABASE_URL` e `SUPABASE_ANON_KEY`. **O repositório é público e não contém credenciais reais** — os valores ficam em `src/config.local.js` (fora do versionamento): copie `src/config.local.example.js` para `src/config.local.js` e preencha. No build/publicação, defina as variáveis de ambiente `SUPABASE_URL`/`SUPABASE_ANON_KEY` (ex.: Netlify) — o `build.mjs` as injeta automaticamente. Use somente a chave publishable/anon no frontend; nunca a service role key.
- Execute `supabase link --project-ref SEU_PROJECT_REF` e `supabase db push` para aplicar `supabase/migrations/`. **Na prática**: utilize o script local `docs/sql-editor/db-setup.sql` (contém os e-mails reais dos admins — fora do git) no SQL Editor do Supabase.
- A tabela usa RLS e atualmente permite operações apenas para usuários autenticados; implemente login antes de publicar dados reais.
- O simulador de rescisão calcula uma estimativa para contratos por prazo indeterminado, discriminando salário, insalubridade ou periculosidade, média mensal informada, datas, férias vencidas, saldo de FGTS, INSS e IRRF estimados pela tabela de 2026. Não contempla contratos a termo, estabilidades, faltas, RRA, múltiplos vínculos, médias detalhadas, convenções coletivas ou substitui TRCT/eSocial.
- A tela de autenticação também permite solicitar redefinição de senha; configure o `Site URL` e `Redirect URLs` em `Authentication → URL Configuration` para apontar para `auth.html` no domínio publicado.
- Conteúdo digitado é inserido com `textContent`, não como HTML.
- A aplicação não usa `eval`, manipuladores inline ou dependências JavaScript externas.
- A política CSP restringe scripts e conexões à própria aplicação. Ao usar Supabase, atualize `connect-src` no `index.html` para incluir `https://SEU_PROJECT_REF.supabase.co`.
- Links para o Google Agenda usam `noopener,noreferrer`.

## Observação técnica e legal

Os cálculos são estimativas de apoio. Alíquotas como RAT/FAP, terceiros, regras do Simples Nacional, incidências e convenções coletivas podem variar. Revise os parâmetros e confirme a legislação vigente antes de produzir documentos oficiais ou apresentar valores ao cliente.
