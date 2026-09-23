# Guia de deploy — Organiza+

> Checklist de produção para o fluxo de aprovação de contas.
> Estado atual: **código pronto (build + 65+ testes verdes)**. O deploy depende
> de 3 ações fora do repositório (banco + Supabase + hospedagem).

## Pré-requisitos resumidos

| # | Item | Status hoje | Necessário |
|---|------|-------------|------------|
| 1 | Migration aplicada no Supabase (arquivo do SQL Editor) | ❌ pendente | **Obrigatório antes de publicar o front** |
| 2 | Confirmação de e-mail ATIVADA | ✅ já ativada | — |
| 3 | Site URL / Redirect URLs configurados | ❌ pendente | Obrigatório |
| 4 | Frontend publicado (Netlify) com as env vars | ❌ pendente | Final |
| 5 | Teste pós-deploy | ❌ pendente | Recomendado |

> ⚠️ Publicar o front **antes** da migration: todo usuário autenticado cai na
> tela de status sem acesso (gate fail-closed) até o banco existir.

---

## Passo 1 — Aplicar a migration no Supabase (SQL Editor)

O repositório é **público**, então os e-mails reais dos administradores **não**
ficam versionados. Eles estão no arquivo **local** `docs/sql-editor/db-setup.sql`
(que está no `.gitignore` e não será commitado).

1. Abra o arquivo `docs/sql-editor/db-setup.sql` (contém a migração completa
   **com os e-mails reais já inseridos** em `bootstrap_admins`).
2. Dashboard do Supabase → projeto (`organizaplusbdd`) → **SQL Editor** →
   *New query* → cole todo o conteúdo → **Run**.
3. A migração é idempotente — pode rodar mais de uma vez sem erro.

**O que ela cria:** tabelas `profiles`, `review_history`, `bootstrap_admins`;
triggers em `auth.users` (cria perfil `pending`, promove admin confirmado —
por e-mail **confirmado**, nunca por e-mail não verificado); RPCs
`admin_*`/`get_my_status`; RLS de `tasks` exigindo conta aprovada; `revoke` de
privilégios de `anon` e de execução de funções.

> Backfill: usuários já cadastrados entram **pendentes** (serão aprovados pelo
> painel). Os 4 e-mails admin recebem `approved + admin` **apenas se já existirem
> com e-mail confirmado** no momento da execução; caso contrário, ganham o papel
> automaticamente quando criarem a conta e confirmarem o e-mail.

## Passo 2 — Confirmação de e-mail

✅ Já ativada no seu projeto (Autenticação → Sign In/Providers → Confirm email).

## Passo 3 — Site URL e Redirect URLs (como configurar)

São 2 campos no mesmo lugar — **Authentication → URL Configuration**:

1. **Site URL** — a URL base do seu app (onde os e-mails apontam por padrão).
   Preencha com o domínio principal, ex.: `https://meu-organiza.netlify.app`
   (ou o domínio próprio). Sem barra no final.

2. **Redirect URLs** — uma **lista de destinos permitidos** para onde o
   Supabase PODE redirecionar o usuário depois que ele clicar em um link de
   e-mail (confirmação de conta ou redefinição de senha). É uma lista de
   permissão: se a URL não estiver na lista, o link é recusado.

   Adicione — botão **Add URL**:
   - `https://meu-organiza.netlify.app/auth` ← a tela de login/reset (onde o
     app reconhece o token de recuperação/confirmação). **A mais importante.**
   - `https://meu-organiza.netlify.app` ← o endereço base (por segurança).
   - Se usar **previews do Netlify**, adicione também
     `https://*.netlify.app` (curinga) para os deploys de preview.

   Depois de adicionar, clique em **Save**.

> Como funciona: quando o usuário recebe um e-mail e clica no link, o Supabase
> valida o destino contra essa lista e o navegador volta ao app **logado**.
> A partir daí o próprio app decide o caminho: aprovado → rotina; pendente ou
> bloqueado → tela de status.

## Passo 4 — Publicar o frontend no Netlify

O build gera `dist/` com todas as páginas e o `netlify.toml` já traz os
redirecionamentos e a CSP. **Importante:** a partir de agora os valores do
Supabase **não estão mais no repositório** — o build os lê de **variáveis de
ambiente**.

- **No painel do Netlify** (site → Site configuration → Environment variables),
  adicione:
  - `SUPABASE_URL` = `https://SEU-PROJETO.supabase.co`
  - `SUPABASE_ANON_KEY` = sua chave anon/publishable
- Build settings: build command `npm run build`, publish directory `dist/`
  (Node ≥ 20, já configurado no `netlify.toml`).
- Em seguida: push no repositório conectado (ou `netlify-cli` com as env vars).

> Se uma destas env vars faltar, o build sai em "modo local" (sem Supabase) —
> seguro, mas o app não conecta ao banco.

## Passo 5 — Teste pós-deploy (5 min)

1. `/auth` → crie uma conta comum → aparece **"Cadastro em análise"** e `/`
   redireciona para `/status`.
2. Confirme o e-mail (o link já foi enviado) — o app volta logado e mantém
   o status pendente.
3. Crie a conta de um e-mail admin + confirme o e-mail → deve nascer
   **admin aprovado**.
4. Em `/admin`, aprove a conta comum → ela passa a acessar o app.
5. Rejeite com motivo → a conta bloqueada vê o motivo.

---

## Segurança do repositório público — medidas aplicadas

- **Chave anon e URL** retiradas de `src/config.js`; os valores reais agora
  ficam em `src/config.local.js` (`.gitignore`) e nas env vars do Netlify.
  Ver `src/config.local.example.js`.
- **E-mails admin** retirados da migration versionada; o placeholder aponta para
  `docs/sql-editor/db-setup.sql` (gitignored, contém os e-mails reais).
- Adicionados **testes guarda** que impedem voltar a commitar chaves/e-mails
  pessoais (`tests/approval.test.js`).
- **Recomendado (opcional):** como a chave anon ficou exposta no histórico do
  repositório, rotacione-a no Supabase (Settings → API → Gerar nova chave
  publishable/anon) e atualize `src/config.local.js` e a env var do Netlify.
  Não é urgente (é a chave publishable, sem acesso a dados), mas é boa prática.

## Itens de atenção restantes

- O `tests/approval-flow.e2e.mjs` usa o endpoint público do projeto para
  redirecionar o tráfego ao mock nos testes — não é segredo, apenas o endereço.
- **LGPD**: contas rejeitadas permanecem em `auth.users` — plano de
  retenção/exclusão é evolução recomendada (fora do v1).
- Notificação por e-mail ao aprovar/rejeitar ficou como **fase 5**.