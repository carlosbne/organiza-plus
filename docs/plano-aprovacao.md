# Plano de Projeto — Fluxo de Aprovação de Contas (Organiza+)

> Documento de planejamento e requisitos para a implementação do fluxo de aprovação de cadastros.
> Versão: 1.0 · Status: proposta para validação

---

## 1. Contexto e problema

Hoje o Organiza+ permite criar conta no Supabase Auth e, existindo sessão, o usuário é levado
direto à aplicação (`src/auth.js`). Não existem papéis (`user`/`admin`) nem controle de acesso
prévio à rotina de DP — dados sensíveis de trabalho ficam visíveis para qualquer pessoa que crie
uma conta.

**Objetivo:** todo novo cadastro nasce como **pendente** e só ganha acesso após **aprovação
manual de um administrador**. O administrador pode **aprovar** ou **rejeitar** (com motivo) e
pode **reabrir manualmente** um cadastro bloqueado.

### Fluxo alvo

```text
Cadastro ──► pending (sem acesso) ──► approved ──► acesso ao app
                    │
                    └──── rejeitado pelo admin (motivo) ──► blocked
                                                                 │
                                admin reabre manualmente ────────┘
```

---

## 2. Requisitos funcionais (RF)

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | Existem dois papéis de usuário: `user` e `admin`. | Alta |
| RF-02 | Todo usuário tem um status de conta em `pending`, `approved` ou `blocked`. | Alta |
| RF-03 | Ao criar a conta, o perfil é criado automaticamente com status `pending`. | Alta |
| RF-04 | Usuários `pending` ou `blocked` **não acessam nenhum dado** da aplicação (tarefas) — bloqueio garantido no banco via RLS. | Alta |
| RF-05 | Usuário pendente vê uma tela de status: "cadastro recebido, aguardando aprovação". | Alta |
| RF-06 | Usuário rejeitado vê tela de status com o **motivo da rejeição** e fica bloqueado até o admin reabrir manualmente. | Alta |
| RF-07 | Existe uma área administrativa no próprio app com a fila de cadastros pendentes. | Alta |
| RF-08 | O admin pode **aprovar** um cadastro pendente. | Alta |
| RF-09 | O admin pode **rejeitar** um cadastro, com campo de motivo (obrigatório ou opcional, a definir). | Alta |
| RF-10 | O admin pode **reabrir** um cadastro bloqueado (volta para a fila como pendente ou é aprovado diretamente — a definir). | Alta |
| RF-11 | O painel de administração mostra histórico de decisões (quem, quando, ação, motivo). | Média |
| RF-12 | A navegação exibe o item "Administração" apenas para usuários `admin`. Visitante não-admin recebe tela de acesso negado. | Alta |
| RF-13 | O primeiro administrador é definido por migration (bootstrap), nunca pelo próprio usuário. | Alta |
| RF-14 | O usuário não pode alterar o próprio status ou papel. | Alta |

## 3. Requisitos não funcionais (RNF)

| ID | Requisito |
|----|-----------|
| RNF-01 | A segurança real é garantida por **RLS no banco**, não apenas por esconder telas no frontend. |
| RNF-02 | Nenhuma chave de `service_role`/secret vai para o navegador. Apenas a chave anon/publishable. |
| RNF-03 | As operações de aprovação/rejeição passam por **RPC `SECURITY DEFINER`** com verificação de admin dentro do Postgres. |
| RNF-04 | Política CSP atualizada conforme necessário (sem relaxar `script-src`). |
| RNF-05 | Acessibilidade: navegação por teclado, `aria`, foco visível — no padrão já usado no app. |
| RNF-06 | Layout responsivo (mobile/desktop), coeso com a identidade visual atual. |
| RNF-07 | Sem framework novo: continua vanilla JS + esbuild + HTML estático no Netlify. |
| RNF-08 | Testes unitários para a lógica de status/gate e testes de segurança do CSP mantidos. |

## 4. Regras de negócio (RN)

- **RN-01 — Gênesis da conta:** todo signup cria perfil `pending`. Não existe "cadastro direto aprovado".
- **RN-02 — Bloqueio real:** `pending` e `blocked` não leem/inserem/alteram/excluem tarefas (RLS nega). O clique em "Sair" funciona normalmente.
- **RN-03 — Decisão exclusiva do admin:** apenas `admin` executa aprovar/rejeitar/reabrir. A checagem é feita no Postgres (RPC), não confiando só no frontend.
- **RN-04 — Imutabilidade:** o usuário não edita `status`/`role` do próprio perfil; políticas de RLS negam.
- **RN-05 — Bloqueio após rejeição:** rejeitado ⇒ `blocked`. Somente ação manual do admin destrava.
- **RN-06 — Primeiro admin:** definido em migration com e-mail fixo / hardcoded (ajustável por variável no seed).

## 5. Modelo de dados

### 5.1 Tabela `public.profiles`

Espelho público de `auth.users` com papel e status:

```sql
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  nome          text,
  role          text not null default 'user' check (role in ('user','admin')),
  status        text not null default 'pending' check (status in ('pending','approved','blocked')),
  rejection_reason text,
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

- `role` como `admin` e `status` **nunca** derivam de `user_metadata` (que o cliente pode editar).
- Trigger `handle_new_user` em `auth.users` (após insert) cria o perfil `pending`.

### 5.2 RLS de `profiles`

| Operação | Condição |
|----------|----------|
| SELECT | próprio perfil **ou** usuário é admin |
| INSERT | somente via trigger (por padrão, nega) |
| UPDATE | somente admin — e `role`/`status` nunca pelo próprio usuário |
| DELETE | nega |

### 5.3 RLS de `tasks` (endurecer a existente)

Além de `auth.uid() = user_id`, as políticas passam a exigir `public.is_account_approved()`
(SECURITY DEFINER) para garantir que usuário pendente/bloqueado não acesse nada mesmo
chamando a API diretamente.

### 5.4 Funções RPC (SECURITY DEFINER)

| Função | Uso |
|--------|-----|
| `get_my_status()` | Retorna status/role/e-mail do usuário logado (usada pela tela de status e gate). |
| `admin_list_profiles(status)` | Lista perfis por status para o painel (somente admin). |
| `admin_review(target_id, decision, reason)` | Aprova/rejeita; grava `reviewed_by`, `reviewed_at`, `rejection_reason`. |
| `admin_reopen(target_id, outcome)` | Reabre cadastro bloqueado (pendente ou aprovado). |

Recomendação: **RPC** em vez de Edge Function — o app é estático (Netlify) e as funções
rodam no Postgres com a checagem de admin embutida. Edge Function só se houver necessidade
de enviar e-mail de notificação depois.

## 6. Telas e fluxo de UI

### 6.1 Gate de acesso (autenticado)

```
auth.html (login/signup)
   │ signup/email confirmado
   ▼
status.html? Guard no app: fetch get_my_status()
   ├─ approved  → app normal (index.html)
   ├─ pending   → tela "Cadastro em análise"
   └─ blocked   → tela "Cadastro bloqueado" (mostra motivo)
```

O gate roda no `init()` do `src/app.js` e também no `src/auth.js` (redireciona para a tela de
status após o signup). Bloqueio definitivo fica no RLS.

### 6.2 Telas a projetar

| # | Tela | Conteúdo |
|---|------|----------|
| 1 | **Status — pendente** | Marca do app, "Cadastro em análise", data da solicitação, aviso de que o acesso será liberado após aprovação, botão Sair. |
| 2 | **Status — bloqueado** | "Cadastro não aprovado", **motivo** em destaque, aviso de bloqueio manual até reabertura, botão Sair. |
| 3 | **Painel de administração** | Topbar com item "Administração", cartões de contadores, abas (Fila / Aprovados / Bloqueados / Histórico), lista de perfis e ações Aprovar/Rejeitar/Reabrir. |
| 4 | **Modal de rejeição** | Textarea de motivo, botões Cancelar / Rejeitar cadastro. |
| 5 | **Acesso negado** | Guard para usuário autenticado não-admin que tentar abrir `/admin`. |

## 7. Segurança — matriz de ameaças

| Ameaça | Mitigação |
|--------|-----------|
| Chamada direta à API REST para ler tarefas estando `pending` | RLS exige `is_account_approved()` |
| Editar próprio `status`/`role` via API | Políticas de UPDATE em `profiles` restringem a admin |
| Usar o RPC de aprovação sem ser admin | Checagem `is_admin()` dentro do RPC (SECURITY DEFINER) |
| Roubar chave de serviço | Nunca é embarcada; só anon no `src/config.js` |
| Código malicioso no painel | `textContent` (padrão atual), CSP restrita, sem `eval` |

## 8. Plano de implementação (fases)

| Fase | Entrega | Estimativa |
|------|---------|-----------|
| **1. Banco** | Migration `profiles` + trigger + RPCs + endurecimento do RLS de `tasks` + seed do primeiro admin | — |
| **2. Status + gate** | `status.html`, helper `src/profile.js`, gate no `app.js`/`auth.js` | — |
| **3. Painel admin** | `admin.html`, `src/admin.js`, integração com os RPCs, guard de acesso | — |
| **4. Endurecimento** | Testes unitários do gate/status, revisão CSP, teste de segurança, e2e | — |
| **5. (Opcional)** | E-mail de notificação via Database Webhooks + Edge Function; ajuste de confirmação de e-mail | — |

## 9. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Recursão de RLS no `is_admin()` | Função `SECURITY DEFINER` com `search_path` fixo e owner que ignora RLS (padrão Supabase) |
| Contas rejeitadas acumulando em `auth.users` | Política de limpeza manual / janela de retenção (fora do escopo inicial) |
| Sessão imediatamente ativa após signup (sem confirmação de e-mail) | Gate de status atende o requisito; revisar confirmação de e-mail para produção |
| Role em JWT desatualizado após promoção a admin | Refresh da sessão (`supabase.auth.refreshSession()`) após mudança de papel |

## 10. Decisões em aberto (para validar)

1. Motivo da rejeição: **obrigatório** ou opcional por padrão? (sugestão: obrigatório)
2. "Reabrir" um bloqueado: volta para a **fila** (`pending`, mantém histórico) ou é **aprovado direto**? (sugestão: voltar para a fila — decisão explícita do admin)
3. Conta rejeitada pode tentar **novo signup com o mesmo e-mail**? (sugestão: bloquear no trigger e redirecionar para a tela de status)
4. Notificação por e-mail quando aprovado/rejeitado (fase 5) entra agora ou depois?
5. Admin pode **promover/rebaiixar** usuários (`user` ↔ `admin`)? (sugestão: fora do escopo v1)

## 11. Fora de escopo (v1)

- Confirmação de e-mail obrigatória no Supabase
- Exclusão (cancelamento) de conta pelo próprio usuário
- Reset de senha pelo admin
- Upload de documentos de identidade para aprovação
- Notificações em tempo real por e-mail (fase 5)

---

*Documento de referência para o desenvolvimento. Os mockups visuais das telas estão em `design/`.*