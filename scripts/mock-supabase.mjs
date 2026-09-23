// Mock do backend Supabase para simular o fluxo de aprovação de contas.
// Implementa o subconjunto do REST/Auth usado pelo Organiza+ e repete as
// regras de negócio da migration 20260922000000 (estados, RLS de tarefas,
// checagem de admin, máquina de transições) para permitir testes e2e locais
// sem Docker/Supabase real.
// Uso: node scripts/mock-supabase.mjs [--port 54321]
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.argv.find((arg, i) => arg === '--port' && process.argv[i + 1]) ? process.argv[process.argv.indexOf('--port') + 1] : 54321);

// E-mails autorizados a virar admin no bootstrap (espelha a migration).
// IMPORTANTE: só contém um e-mail fictício de teste — os e-mails reais dos
// administradores ficam no script local docs/sql-editor/db-setup.sql (fora do
// controle de versão), nunca em arquivos versionados deste repositório público.
const BOOTSTRAP_EMAILS = new Set([
  'admin@organiza.test',
]);

const store = {
  users: new Map(),  // id -> user
  tasks: new Map(),  // taskId -> { ...task, owner_id }
  history: [],       // { profile_email, action, reason, actor_email, created_at }
};

const now = () => new Date().toISOString();
const adminId = randomUUID();

function seedAdmin() {
  store.users.set(adminId, {
    id: adminId,
    email: 'admin@organiza.test',
    password: 'AdminSenha123!',
    role: 'admin',
    status: 'approved',
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: now(),
    updated_at: now(),
    email_confirmed_at: now(),
  });
}

seedAdmin();

// ---- JWT-like: codifica/decodifica payload (sem verificação de assinatura) ----
function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function issueToken(user) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    session_id: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    app_metadata: { provider: 'email', providers: ['email'], role: user.role },
    user_metadata: {},
  };
  return `${b64url(header)}.${b64url(payload)}.mock`;
}

function decodeToken(bearer) {
  const token = (bearer || '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ---- Utilitários HTTP ----
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'apikey, authorization, content-type, prefer, accept, x-client-info, x-supabase-api-version');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function authError(res, message, code = 'forbidden', status = 403) {
  sendJson(res, status, { message, code, details: null, hints: null });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sessionResponse(user) {
  const base = {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.email_confirmed_at,
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
  const userObject = {
    ...base,
    identities: [{
      id: user.id,
      user_id: user.id,
      identity_data: { sub: user.id, email: user.email },
      provider: 'email',
      created_at: user.created_at,
      last_sign_in_at: user.created_at,
      updated_at: user.updated_at,
    }],
  };
  return {
    ...userObject,
    access_token: issueToken(user),
    refresh_token: `mock-refresh-${user.id}`,
    token_type: 'bearer',
    expires_in: 3600,
    user: userObject,
  };
}

// ---- Regras de negócio (espelham a migration) ----
function canUseTasks(user) {
  return Boolean(user && user.status === 'approved');
}

function isAdmin(user) {
  return Boolean(user && user.role === 'admin');
}

function createUser(email, password) {
  const nowIso = now();
  const confirmed = true; // simulação: confirmação instantânea
  const isBootstrap = BOOTSTRAP_EMAILS.has(email.toLowerCase());
  return {
    id: randomUUID(),
    email: email.toLowerCase(),
    password,
    role: isBootstrap ? 'admin' : 'user',
    status: isBootstrap ? 'approved' : 'pending',
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    email_confirmed_at: confirmed ? nowIso : null,
  };
}

function pushHistory(user, actor, action, reason = null) {
  store.history.push({
    profile_email: user.email,
    action,
    reason,
    actor_email: actor.email,
    created_at: now(),
  });
}

// ---- Handlers do Auth ----
function handleSignup(req, res, body) {
  const email = String(body.email || '').toLowerCase();
  const existing = [...store.users.values()].find((u) => u.email === email);
  if (existing) {
    // Mesmo formato do GoTrue para e-mail já cadastrado.
    sendJson(res, 400, { code: 'user_already_exists', message: 'User already registered', weak_password: null });
    return;
  }
  const user = createUser(email, String(body.password || ''));
  store.users.set(user.id, user);
  sendJson(res, 200, sessionResponse(user));
}

function handleToken(req, res, body) {
  const email = String(body.email || '').toLowerCase();
  const password = String(body.password || '');
  const user = [...store.users.values()].find((u) => u.email === email);
  if (!user || user.password !== password) {
    sendJson(res, 400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
    return;
  }
  sendJson(res, 200, sessionResponse(user));
}

// ---- Handlers do Rest (RPC + tasks) ----
function handleRpc(req, res, body, user) {
  const path = req.url.split('?')[0];
  const name = path.split('/rpc/').pop();

  if (name === 'get_my_status') {
    if (!user) return authError(res, 'Acesso negado', 'forbidden');
    return sendJson(res, 200, [{
      status: user.status,
      role: user.role,
      email: user.email,
      rejection_reason: user.rejection_reason,
      reviewed_at: user.reviewed_at,
      created_at: user.created_at,
    }]);
  }

  if (!isAdmin(user)) {
    return authError(res, 'Acesso negado', 'forbidden');
  }

  if (name === 'admin_list_profiles') {
    const filter = body.in_status ?? null;
    const rows = [...store.users.values()]
      .filter((u) => (filter === null || u.status === filter))
      .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || a.created_at.localeCompare(b.created_at))
      .map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        rejection_reason: u.rejection_reason,
        reviewed_by_email: u.reviewed_by ? (store.users.get(u.reviewed_by)?.email ?? null) : null,
        reviewed_at: u.reviewed_at,
        created_at: u.created_at,
      }));
    return sendJson(res, 200, rows);
  }

  if (name === 'admin_review') {
    const target = store.users.get(body.in_target_id);
    const decision = body.in_decision;
    const reason = body.in_reason ? String(body.in_reason) : null;
    if (reason !== null && reason.length > 500) return authError(res, 'Motivo muito longo (máximo de 500 caracteres)', 'too_long', 400);
    if (!target) return authError(res, 'Transição de status não permitida para este cadastro', 'invalid_transition', 400);
    const okTransition =
      (target.status === 'pending' && ['approved', 'blocked'].includes(decision)) ||
      (target.status === 'approved' && decision === 'blocked');
    if (!okTransition) return authError(res, 'Transição de status não permitida para este cadastro', 'invalid_transition', 400);
    target.status = decision;
    target.rejection_reason = decision === 'blocked' ? (reason || null) : null;
    target.reviewed_by = user.id;
    target.reviewed_at = now();
    pushHistory(target, user, decision, decision === 'blocked' ? reason : null);
    return sendJson(res, 200, {});
  }

  if (name === 'admin_reopen') {
    const target = store.users.get(body.in_target_id);
    if (!target || target.status !== 'blocked') return authError(res, 'Cadastro não está bloqueado', 'invalid_transition', 400);
    target.status = 'pending';
    target.rejection_reason = null;
    target.reviewed_by = user.id;
    target.reviewed_at = now();
    pushHistory(target, user, 'reopened');
    return sendJson(res, 200, {});
  }

  if (name === 'admin_list_history') {
    const limit = Math.max(1, Math.min(Number(body.in_limit ?? 50) || 50, 200));
    return sendJson(res, 200, [...store.history].reverse().slice(0, limit));
  }

  return authError(res, `Função RPC desconhecida: ${name}`, 'not_found', 404);
}

function handleTasks(req, res, user, method, body) {
  if (!canUseTasks(user)) {
    return authError(res, 'Acesso negado: conta pendente ou bloqueada', 'forbidden');
  }
  if (method === 'GET') {
    const rows = [...store.tasks.values()]
      .filter((t) => t.owner_id === user.id)
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return sendJson(res, 200, rows);
  }
  const bodyPayload = Array.isArray(body) ? body[0] : body;
  if (method === 'POST' && bodyPayload?.id) {
    const task = { ...bodyPayload, owner_id: user.id, created_at: bodyPayload.created_at ?? now() };
    store.tasks.set(task.id, task);
    return sendJson(res, 201, [task]);
  }
  if (method === 'PATCH') {
    const task = store.tasks.get(bodyPayload?.id);
    if (task && task.owner_id === user.id) {
      const updated = { ...task, ...bodyPayload, id: task.id, owner_id: user.id };
      store.tasks.set(task.id, updated);
      return sendJson(res, 200, [updated]);
    }
    return sendJson(res, 200, []);
  }
  if (method === 'DELETE') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const idFilter = qs.get('id'); // ex.: "eq.<id>"
    if (idFilter?.startsWith('eq.')) {
      const id = idFilter.slice(3);
      if (store.tasks.get(id)?.owner_id === user.id) store.tasks.delete(id);
    }
    return sendJson(res, 200, []);
  }
  return authError(res, 'Método não suportado', 'not_supported', 405);
}

// ---- Servidor ----
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;

  // Endpoint de inspeção para as asserções do teste (fora do alcance do app).
  if (path === '/__test/snapshot' && method === 'GET') {
    return sendJson(res, 200, {
      users: [...store.users.values()].map(({ password: _p, ...u }) => u),
      tasks: [...store.tasks.values()],
      history: store.history,
    });
  }

  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const body = await readBody(req);
  const authHeader = req.headers.authorization;
  const payload = decodeToken(authHeader);
  const user = payload?.sub ? store.users.get(payload.sub) : null;

  if (path === '/auth/v1/signup') return handleSignup(req, res, body);
  if (path === '/auth/v1/token') return handleToken(req, res, body);
  if (path === '/auth/v1/logout') return sendJson(res, 200, {});
  if (path.startsWith('/rest/v1/rpc/')) return handleRpc(req, res, body, user);
  if (path === '/rest/v1/tasks') return handleTasks(req, res, user, method, body);

  sendJson(res, 404, { message: 'Endpoint não encontrado no mock', code: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Mock Supabase em http://127.0.0.1:${PORT}`);
});