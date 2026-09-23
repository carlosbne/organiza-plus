import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isAdmin,
  isApproved,
  normalizeProfile,
} from '../src/profile.js';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

// ---------------------------------------------------------------------------
// Lógica pura do perfil
// ---------------------------------------------------------------------------

test('normalizeProfile converte a linha do RPC em perfil normalizado', () => {
  assert.deepEqual(normalizeProfile({ status: 'blocked', role: 'user', email: 'a@b.co', rejection_reason: 'x', reviewed_at: '2026-09-22', created_at: '2026-09-21' }), {
    status: 'blocked',
    role: 'user',
    email: 'a@b.co',
    rejectionReason: 'x',
    reviewedAt: '2026-09-22',
    createdAt: '2026-09-21',
  });
});

test('normalizeProfile aplica padrões seguros quando faltam campos', () => {
  const profile = normalizeProfile({});
  assert.equal(profile.status, 'pending');
  assert.equal(profile.role, 'user');
  assert.equal(profile.rejectionReason, '');
});

test('normalizeProfile retorna null sem linha (usuário sem perfil)', () => {
  assert.equal(normalizeProfile(null), null);
  assert.equal(normalizeProfile(undefined), null);
});

test('isApproved exige status approved e jamais aprova perfil ausente', () => {
  assert.equal(isApproved({ status: 'approved' }), true);
  assert.equal(isApproved({ status: 'pending' }), false);
  assert.equal(isApproved({ status: 'blocked' }), false);
  assert.equal(isApproved(null), false);
});

test('isAdmin exige papel admin', () => {
  assert.equal(isAdmin({ role: 'admin' }), true);
  assert.equal(isAdmin({ role: 'user' }), false);
  assert.equal(isAdmin(null), false);
});

// ---------------------------------------------------------------------------
// Migration: endurecimento de segurança
// ---------------------------------------------------------------------------

test('migration de fluxo de aprovação aplica as barreiras preventivas', async () => {
  const migration = await source('supabase/migrations/20260922000000_profile_approval_flow.sql');

  // RPCs SECURITY DEFINER com search_path fixo (anti hijacking)
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /create or replace function public\.is_admin/);
  assert.match(migration, /create or replace function public\.is_account_approved/);

  // Toda função administrativa verifica o papel internamente
  assert.match(migration, /if not public\.is_admin\(\) then/);
  assert.match(migration, /raise exception 'Acesso negado'/);

  // Bootstrap dos admins: a tabela existe e o mecanismo está presente, mas
  // NENHUM e-mail pessoal pode estar versionado (repositório público).
  assert.match(migration, /create table if not exists public\.bootstrap_admins/);
  assert.match(migration, /handle_new_user/);
  assert.doesNotMatch(migration, /gmail\.com/, 'e-mails pessoais não podem ficar versionados');
  assert.match(migration, /SUBSTITUA_PELO_EMAIL_DO_ADMIN@exemplo\.com/, 'placeholder de admin deve usar domínio de exemplo');

  // Trigger de criação de perfil no signup
  assert.match(migration, /create trigger on_auth_user_created/);
  assert.match(migration, /execute function public\.handle_new_user/);

  // Promoção a admin exige e-mail confirmado (previne escalonamento)
  assert.match(migration, /new\.email_confirmed_at is not null/);
  assert.match(migration, /promote_confirmed_admin/);
  assert.match(migration, /create trigger on_auth_user_confirmed/);

  // Endurecimento do RLS de tarefas exigindo conta aprovada (por política)
  const chunks = migration.split(/create policy/);
  for (const name of ['users can view own tasks', 'users can insert own tasks', 'users can update own tasks', 'users can delete own tasks']) {
    const chunk = chunks.find((c) => c.trim().startsWith(`"${name}"`));
    assert.ok(chunk, `política "${name}" inexistente`);
    assert.match(chunk, /is_account_approved\(\)/, `política "${name}" sem exigir conta aprovada`);
  }

  // Revoga privilégios diretos das tabelas de perfil (acesso só via RPC)
  assert.match(migration, /revoke all on table public\.profiles from anon, authenticated/);
  assert.match(migration, /revoke all on table public\.review_history from anon, authenticated/);
  assert.match(migration, /revoke all on table public\.bootstrap_admins from anon, authenticated/);

  // Execução das funções restrita a authenticated (sem abuso anônimo)
  assert.match(migration, /revoke execute on function public\.get_my_status\(\) from public, anon/);
  assert.match(migration, /revoke execute on function public\.admin_list_profiles\(text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_my_status\(\) to authenticated/);

  // Reabertura devolve o cadastro para a fila (decisão de produto)
  assert.match(migration, /status\s*=\s*'pending'/);
  assert.match(migration, /insert into public\.review_history/);

  // Máquina de estados: pending -> approved|blocked; approved -> blocked
  assert.match(migration, /\(status = 'pending' and in_decision in \('approved', 'blocked'\)\)/);
  assert.match(migration, /\(status = 'approved' and in_decision = 'blocked'\)/);
});

// ---------------------------------------------------------------------------
// Gate no frontend (fail-closed)
// ---------------------------------------------------------------------------

test('app.js bloqueia acesso sem aprovação e isola o storage por usuário', async () => {
  const app = await source('src/app.js');
  assert.match(app, /getMyStatus/);
  assert.match(app, /ensureApprovedSession/);
  assert.match(app, /window\.location\.replace\('\.\/status'\)/);
  assert.match(app, /taskKey\(\)/);
  assert.match(app, /STORAGE_KEY\}:\$\{currentSession\.user\.id\}/, 'storage deve ser chaveado por usuário');
  assert.match(app, /removeStorage\(taskStorage, taskKey\(\)\)/, 'logout deve limpar o storage do usuário');
});

test('consultas.js também aplica o gate de aprovação', async () => {
  const consultas = await source('src/consultas.js');
  assert.match(consultas, /getMyStatus/);
  assert.match(consultas, /window\.location\.replace\('\.\/status'\)/);
});

test('auth.js encaminha novos cadastros para a tela de status', async () => {
  const auth = await source('src/auth.js');
  assert.match(auth, /window\.location\.href = '\.\/status'/);
  assert.match(auth, /already registered/i);
});

test('supabase.js expõe exclusivamente as funções RPC do fluxo', async () => {
  const supabase = await source('src/supabase.js');
  for (const name of ['getMyStatus', 'adminListProfiles', 'adminReview', 'adminReopen', 'adminListHistory']) {
    assert.match(supabase, new RegExp(`export const ${name}`));
  }
});

// ---------------------------------------------------------------------------
// Páginas: status e administração
// ---------------------------------------------------------------------------

test('status.html apresenta os estados pendente, bloqueado e falha fechada', async () => {
  const status = await source('status.html');
  assert.match(status, /id="pendingCard"/);
  assert.match(status, /id="blockedCard"/);
  assert.match(status, /id="unknownCard"/);
  assert.match(status, /id="blockedReasonText"/);
  assert.match(status, /id="signOutButton"/);
});

test('admin.html tem guard de acesso, painel e modal de rejeição', async () => {
  const admin = await source('admin.html');
  assert.match(admin, /id="accessDenied"/);
  assert.match(admin, /id="adminContent"/);
  assert.match(admin, /id="rejectDialog"/);
  assert.match(admin, /id="rejectReason"/);
  assert.match(admin, /data-tab="pending"/);
  assert.match(admin, /data-tab="history"/);
});

// ---------------------------------------------------------------------------
// Build e deploy
// ---------------------------------------------------------------------------

test('build e redeploy incluem as novas páginas e bundles', async () => {
  const build = await source('build.mjs');
  assert.match(build, /'status\.html'/);
  assert.match(build, /'admin\.html'/);
  assert.match(build, /'src\/status\.js'/);
  assert.match(build, /'src\/admin\.js'/);

  const netlify = await source('netlify.toml');
  assert.match(netlify, /from = "\/status"/);
  assert.match(netlify, /from = "\/admin"/);
});

test('confirmação de e-mail habilitada no config local (bootstrap admin seguro)', async () => {
  const config = await source('supabase/config.toml');
  assert.match(config, /enable_confirmations = true/);
});

test('servidor de desenvolvimento resolve rotas sem extensão para .html', async () => {
  const serve = await source('scripts/serve.mjs');
  for (const route of ['/admin', '/status', '/auth', '/consultas']) {
    assert.match(serve, new RegExp(`fileName\\.startsWith\\('${route}'\\)`));
  }
  assert.match(serve, /`\$\{fileName\}\.html`/);
});

test('registro config local não versiona credenciais reais', async () => {
  const config = await source('src/config.js');
  const example = await source('src/config.local.example.js');
  assert.doesNotMatch(config, /sb_publishable_[A-Za-z0-9_-]+/, 'chave anon real não pode ficar na config versionada');
  assert.doesNotMatch(config, /https:\/\/[a-z0-9]+\.supabase\.co/, 'URL real não pode ficar na config versionada');
  assert.match(config, /config\.local\.js/, 'config.js deve delegar ao arquivo local');
  assert.match(example, /SEU-PROJETO/, 'exemplo deve usar valores fictícios');
});