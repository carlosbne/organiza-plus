-- ============================================================================
-- Fluxo de aprovação de contas — Organiza+
-- Migration 20260922000000
--  - Tabela public.profiles (papel/status por usuário)
--  - Tabela public.review_history (trilha imutável das decisões do admin)
--  - Tabela public.bootstrap_admins (emails promovidos a admin no signup)
--  - Trigger em auth.users (cria perfil automático no signup)
--  - Funções RPC SECURITY DEFINER (única via de acesso aos perfis no cliente)
--  - Endurecimento do RLS de public.tasks exigindo conta aprovada
--  - Revoga privilégios diretos de anon/authenticated sobre tabelas de perfil
--
-- Decisões de produto aplicadas:
--   * Novo cadastro nasce 'pending'; acesso só após 'approved'.
--   * Rejeição => 'blocked' (motivo opcional, máx. 500); reabertura manual
--     pelo admin devolve o cadastro para a fila ('pending').
--   * Admin não gerencia papéis nesta versão (bootstrap controla 'admin').
--   * Usuários já existentes (pré-migration) entram 'pending', exceto os
--     emails confirmados listados em bootstrap_admins.
--
-- Requisito de segurança (bootstrap admin):
--   Promoção a admin exige E-MAIL CONFIRMADO (auth.users.email_confirmed_at).
--   Habilite a confirmação de e-mail no Supabase (Authentication > Sign In /
--   Providers ou [auth.email] enable_confirmations) para que ninguém consiga
--   criar uma conta com um e-mail de admin sem ter acesso à caixa de entrada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela de perfis
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  nome             text,
  role             text not null default 'user' check (role in ('user','admin')),
  status           text not null default 'pending' check (status in ('pending','approved','blocked')),
  rejection_reason text,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Histórico de decisões (somente insert via funções SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create table if not exists public.review_history (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null check (action in ('approved','blocked','reopened')),
  reason     text,
  created_at timestamptz not null default now()
);

create index if not exists review_history_profile_idx on public.review_history (profile_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Emails autorizados a virar admin (bootstrap)
--    Normalizados em minúsculas; a promoção exige e-mail confirmado e só
--    acontece nos triggers handle_new_user / promote_confirmed_admin.
--    >>> SEGURANÇA: este repositório é PÚBLICO — e-mails reais NÃO ficam aqui.
--        Execute o script docs/sql-editor/db-setup.sql no SQL Editor do
--        Supabase (contém esta migration com os e-mails reais dos admins).
--        Se preferir, substitua a linha comentada abaixo pelos e-mails reais
--        ANTES de executar esta migration.
-- ---------------------------------------------------------------------------
create table if not exists public.bootstrap_admins (
  email text primary key
);

-- insert into public.bootstrap_admins (email) values ('SUBSTITUA_PELO_EMAIL_DO_ADMIN@exemplo.com') on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Helpers de autorização (SECURITY DEFINER, search_path fixo)
--    Owner = postgres => ignora RLS automaticamente, evitando recursão
--    nas políticas de public.profiles / public.tasks.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_account_approved()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS de public.profiles
--    As operações de leitura/escrita do cliente usam os RPCs abaixo;
--    as políticas garantem defesa em profundidade e acesso de leitura
--    ao próprio perfil (usado pela tela de status via RPC).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "users can view own profile" on public.profiles;
create policy "users can view own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

drop policy if exists "admins can view all profiles" on public.profiles;
create policy "admins can view all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "admins can update profiles" on public.profiles;
create policy "admins can update profiles"
  on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Sem políticas de insert/delete: criação via trigger; exclusão via cascade.

alter table public.review_history enable row level security;

drop policy if exists "admins can view review history" on public.review_history;
create policy "admins can view review history"
  on public.review_history for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. Trigger de criação de perfil no signup (auth.users)
--    Promoção a admin SÓ com e-mail confirmado — impede escalonamento por
--    signup com e-mail de admin sem acesso à caixa de entrada.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role   text;
  v_status text;
begin
  if new.email is null then
    return new;
  end if;

  select
    case
      when b.email is not null and new.email_confirmed_at is not null then 'admin'
      else 'user'
    end,
    case
      when b.email is not null and new.email_confirmed_at is not null then 'approved'
      else 'pending'
    end
  into v_role, v_status
  from (select 1) as dummy
  left join public.bootstrap_admins b on lower(b.email) = lower(new.email);

  insert into public.profiles (id, email, role, status)
  values (new.id, new.email::text, v_role, v_status)
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Promove a admin quando um e-mail de bootstrap é confirmado (a confirmação
-- chega depois do INSERT, via update de email_confirmed_at).
create or replace function public.promote_confirmed_admin()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null
     and new.email_confirmed_at is not null
     and exists (
       select 1 from public.bootstrap_admins b
       where lower(b.email) = lower(new.email)
     ) then
    update public.profiles
       set role = 'admin',
           status = 'approved',
           updated_at = now()
     where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.promote_confirmed_admin();

-- Sincroniza o e-mail do perfil quando o usuário troca o próprio e-mail.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email::text, updated_at = now() where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_update on auth.users;
create trigger on_auth_user_email_update
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- 7. Backfill: usuários existentes (pré-migration) entram 'pending',
--    exceto emails de bootstrap já confirmados (approved + admin).
--    Determinístico e seguro.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, email, role, status)
select
  u.id,
  u.email::text,
  case when b.email is not null and u.email_confirmed_at is not null then 'admin' else 'user' end,
  case when b.email is not null and u.email_confirmed_at is not null then 'approved' else 'pending' end
from auth.users u
left join public.bootstrap_admins b on lower(b.email) = lower(u.email)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 8. RPCs administrativos (única via de escrita) — SEMPRE verificam is_admin()
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_profiles(in_status text default null)
returns table (
  id uuid, email text, role text, status text,
  rejection_reason text, reviewed_by_email text, reviewed_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;

  return query
    select
      p.id, p.email, p.role, p.status,
      p.rejection_reason,
      u.email::text as reviewed_by_email,
      p.reviewed_at,
      p.created_at
    from public.profiles p
    left join auth.users u on u.id = p.reviewed_by
    where (in_status is null or p.status = in_status)
    order by
      case p.status when 'pending' then 0 when 'blocked' then 1 else 2 end,
      p.created_at;
end $$;

create or replace function public.admin_review(in_target_id uuid, in_decision text, in_reason text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;

  if in_decision not in ('approved','blocked') then
    raise exception 'Decisão inválida';
  end if;

  if in_reason is not null and length(in_reason) > 500 then
    raise exception 'Motivo muito longo (máximo de 500 caracteres)';
  end if;

  -- Máquina de estados: pending -> approved|blocked; approved -> blocked
  -- (revogação). Transições a partir de 'blocked' passam por admin_reopen.
  update public.profiles
     set status           = in_decision,
         rejection_reason = case when in_decision = 'blocked' then nullif(in_reason, '') else null end,
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   where id = in_target_id
     and (
       (status = 'pending' and in_decision in ('approved', 'blocked'))
       or (status = 'approved' and in_decision = 'blocked')
     );

  if not found then
    raise exception 'Transição de status não permitida para este cadastro';
  end if;

  insert into public.review_history (profile_id, actor_id, action, reason)
  values (
    in_target_id,
    auth.uid(),
    in_decision,
    case when in_decision = 'blocked' then nullif(in_reason, '') else null end
  );
end $$;

create or replace function public.admin_reopen(in_target_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;

  update public.profiles
     set status           = 'pending',
         rejection_reason = null,
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   where id = in_target_id
     and status = 'blocked';

  if not found then
    raise exception 'Cadastro não está bloqueado';
  end if;

  insert into public.review_history (profile_id, actor_id, action)
  values (in_target_id, auth.uid(), 'reopened');
end $$;

create or replace function public.admin_list_history(in_limit integer default 50)
returns table (
  profile_email text, action text, reason text, actor_email text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;

  return query
    select
      p.email as profile_email,
      h.action,
      h.reason,
      u.email::text as actor_email,
      h.created_at
    from public.review_history h
    join public.profiles p on p.id = h.profile_id
    left join auth.users u on u.id = h.actor_id
    order by h.created_at desc
    limit greatest(1, least(in_limit, 200));
end $$;

-- ---------------------------------------------------------------------------
-- 9. Função pública de status (tela de status / gate do app)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_status()
returns table (
  status text, role text, email text,
  rejection_reason text, reviewed_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.status, p.role, p.email, p.rejection_reason, p.reviewed_at, p.created_at
  from public.profiles p
  where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 10. Endurecimento do RLS de public.tasks:
--     além de dados do próprio usuário, exige conta aprovada.
-- ---------------------------------------------------------------------------
drop policy if exists "users can view own tasks" on public.tasks;
drop policy if exists "users can insert own tasks" on public.tasks;
drop policy if exists "users can update own tasks" on public.tasks;
drop policy if exists "users can delete own tasks" on public.tasks;
drop policy if exists "authenticated users can manage tasks" on public.tasks;

create policy "users can view own tasks"
  on public.tasks for select to authenticated
  using (auth.uid() = user_id and public.is_account_approved());

create policy "users can insert own tasks"
  on public.tasks for insert to authenticated
  with check (auth.uid() = user_id and public.is_account_approved());

create policy "users can update own tasks"
  on public.tasks for update to authenticated
  using (auth.uid() = user_id and public.is_account_approved())
  with check (auth.uid() = user_id and public.is_account_approved());

create policy "users can delete own tasks"
  on public.tasks for delete to authenticated
  using (auth.uid() = user_id and public.is_account_approved());

-- ---------------------------------------------------------------------------
-- 11. Revoga privilégios diretos de anon/authenticated sobre as tabelas de
--     perfil/histórico/bootstrap. O acesso do cliente passa 100% pelos RPCs
--     (SECURITY DEFINER). public.tasks segue com grant padrão (via RLS).
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.review_history from anon, authenticated;
revoke all on table public.bootstrap_admins from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Execução das funções: apenas autenticados (elimina abuso anônimo).
--     Funções de trigger não dependem de EXECUTE, então o revoke é seguro.
-- ---------------------------------------------------------------------------
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_account_approved() from public, anon;
revoke execute on function public.get_my_status() from public, anon;
revoke execute on function public.admin_list_profiles(text) from public, anon;
revoke execute on function public.admin_review(uuid, text, text) from public, anon;
revoke execute on function public.admin_reopen(uuid) from public, anon;
revoke execute on function public.admin_list_history(integer) from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.promote_confirmed_admin() from public, anon;
revoke execute on function public.sync_profile_email() from public, anon;
revoke execute on function public.set_updated_at() from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_account_approved() to authenticated;
grant execute on function public.get_my_status() to authenticated;
grant execute on function public.admin_list_profiles(text) to authenticated;
grant execute on function public.admin_review(uuid, text, text) to authenticated;
grant execute on function public.admin_reopen(uuid) to authenticated;
grant execute on function public.admin_list_history(integer) to authenticated;