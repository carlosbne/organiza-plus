create table if not exists public.tasks (
  id text primary key,
  title text not null check (char_length(title) between 1 and 120),
  due_date date,
  company_code text,
  company text,
  priority text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  notes text,
  done boolean not null default false,
  was_overdue boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

-- A política autenticada será adicionada quando o login for implementado.
-- Não deixe dados públicos em produção sem definir a estratégia de auth.
create policy "authenticated users can manage tasks"
  on public.tasks for all to authenticated
  using (true) with check (true);

create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists tasks_done_idx on public.tasks (done);
