// E2E do fluxo de aprovação de contas — simula o ciclo completo com o app real:
//   signup → pendente (sem acesso) → admin aprova/rejeita → acesso → reabertura.
//
// Infraestrutura (sem Docker/Supabase):
//   - scripts/mock-supabase.mjs : mock do backend (auth + RPCs + tasks) que
//     reproduz as regras de negócio da migration (estados, RLS, admin).
//   - scripts/serve.mjs --dist   : serve o build real em http://127.0.0.1:4173.
//   - Chrome headless + CDP      : redireciona o tráfego de
//     https://*.supabase.co para o mock.
//
// Uso: node tests/approval-flow.e2e.mjs
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 4173;
const MOCK_PORT = 54321;
const DEBUG_PORT = 9224;
// URL do projeto derivada em runtime — repositório público NUNCA versiona o
// valor real (o Netlify detecta segredos em arquivos). Fonte: env SUPABASE_URL
// ou src/config.local.js (gitignored). Sem fonte, o teste é encerrado com skip.
let SUPABASE_URL = process.env.SUPABASE_URL || '';
if (!SUPABASE_URL) {
  try {
    ({ SUPABASE_URL } = await import('../src/config.local.js'));
  } catch {}
}
if (!SUPABASE_URL) {
  console.log('Teste não executado: SUPABASE_URL não disponível (defina a env ou crie src/config.local.js).');
  process.exit(2);
}
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ADMIN_EMAIL = 'admin@organiza.test';
const ADMIN_PASS = 'AdminSenha123!';
const USER_A = 'ana.teste@empresa.test';
const USER_B = 'bruno.teste@empresa.test';
const USER_PASS = 'Senha123!';
const REJECT_REASON = 'E-mail fora da base corporativa';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- bootstrap dos processos ----
let chromePath = CHROME;
try { await access(CHROME); } catch { chromePath = null; }
if (!chromePath) {
  console.log('Chrome não encontrado; teste do fluxo não executado.');
  process.exit(2);
}

const mock = spawn(process.execPath, [join(ROOT, 'scripts', 'mock-supabase.mjs'), '--port', String(MOCK_PORT)], { stdio: 'ignore' });
const server = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs'), '--dist', '--port', String(PORT)], { stdio: 'ignore' });
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1440,1200', `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

async function waitForHttp(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`Serviço não subiu: ${url}`);
}

await waitForHttp(`http://127.0.0.1:${MOCK_PORT}/__test/snapshot`);
await waitForHttp(`http://127.0.0.1:${PORT}/auth`);
await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 40);

// ---- CDP ----
const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let seq = 0;
const pending = new Map();
const runtimeErrors = [];
const traffic = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const p = pending.get(message.id);
    pending.delete(message.id);
    message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    // O 403 intencional do passo "RLS" gera erro de recurso no console; os demais são reais.
    if (!/403 \(Forbidden\)/.test(message.params.entry.text)) runtimeErrors.push(`console: ${message.params.entry.text}`);
  }
  if (message.method === 'Network.responseReceived') {
    const url = message.params.response.url;
    if (url.includes('supabase.co') || url.includes('54321')) {
      traffic.push(`RES ${message.params.response.status} ${url}`);
    }
  }
  if (message.method === 'Page.javascriptDialogOpening') {
    // confirm()/alert() nativos travam a thread no headless: aceita sempre.
    cmd('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  }
  if (message.method === 'Fetch.requestPaused') handleRequestPaused(message.params).catch((error) => runtimeErrors.push(`intercept: ${error.message}`));
});

function cmd(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const CORS_HEADERS = [
  { name: 'Access-Control-Allow-Origin', value: '*' },
  { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
  { name: 'Access-Control-Allow-Headers', value: 'apikey, authorization, content-type, content-profile, accept-profile, prefer, accept, x-client-info, x-supabase-api-version' },
];

async function handleRequestPaused(params) {
  const { requestId, request } = params;
  if (request.method === 'OPTIONS') {
    traffic.push(`OPTIONS ${request.url}`);
    await cmd('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS_HEADERS, body: '' });
    return;
  }
  traffic.push(`${request.method} ${request.url}`);
  const url = new URL(request.url);
  url.protocol = 'http:';
  url.host = `127.0.0.1:${MOCK_PORT}`;
  await cmd('Fetch.continueRequest', { requestId, url: url.toString() });
}

await cmd('Page.enable');
await cmd('Runtime.enable');
await cmd('Log.enable');
await cmd('Network.enable');
await cmd('Fetch.enable', { patterns: [{ urlPattern: `*${new URL(SUPABASE_URL).host}*` }] });

// ---- helpers de UI ----
const evaluate = async (expression) => {
  const response = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(`Erro na página: ${response.exceptionDetails.text}`);
  return response.result.value;
};
const goto = async (path) => { await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` }); await sleep(700); };
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
const fill = (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
const submit = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.requestSubmit()`);
const waitFor = async (expression, timeout = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await sleep(150);
  }
  throw new Error(`Timeout aguardando: ${expression}`);
};
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);

async function signupViaUi(email, password) {
  await goto('/auth');
  await waitFor(`!!document.getElementById('authToggle')`);
  await click('#authToggle');
  await waitFor(`!document.getElementById('registerCard').hidden`);
  await fill('#registerEmail', email);
  await fill('#registerPassword', password);
  await submit('#registerForm');
  await waitFor(`location.pathname === '/status'`);
  await waitFor(`!document.getElementById('pendingCard').hidden`);
}

async function login(email, password) {
  await goto('/auth');
  await waitFor(`!!document.getElementById('authForm')`);
  await fill('#authEmail', email);
  await fill('#authPassword', password);
  await submit('#authForm');
}

async function logout() {
  await click('#logoutLink, #signOutButton');
  await waitFor(`location.pathname === '/auth'`);
}

async function clickActionFor(email, action) {
  return evaluate(`(() => {
    const items = [...document.querySelectorAll('.admin-item')];
    const item = items.find((i) => i.querySelector('.admin-item-id strong')?.textContent === ${JSON.stringify(email)});
    const button = item?.querySelector('button[data-action="${action}"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

// ---- cenário ----
const steps = [];
const record = (name, ok) => {
  steps.push({ name, ok });
  process.stdout.write(`${ok ? 'ok ' : 'FAIL'} - ${name}\n`);
};

const watchdog = setTimeout(() => {
  process.stdout.write(`WATCHDOG: travado. Tráfego:\n${traffic.slice(-20).join('\n')}\n`);
  process.exit(3);
}, 90000);
watchdog.unref();

try {
  await evaluate(`window.confirm = () => true; window.alert = () => {};`);

  // 1. Signup → pendente
  await signupViaUi(USER_A, USER_PASS);
  assert.equal(await text('#pendingEmail'), USER_A);
  record('signup cria conta pendente (tela /status)', true);

  // 2. Gate: pendente não acessa o app nem os dados (API)
  await goto('/');
  await waitFor(`location.pathname === '/status'`);
  record('gate: pendente é redirecionado de / para /status', true);
  const rls = await evaluate(`(async () => {
    const key = (Object.keys(localStorage).find((k) => k.includes('auth-token')) || 'supabase.auth.token');
    const raw = localStorage.getItem(key);
    const session = raw ? JSON.parse(raw) : null;
    if (!session) return { missing: true };
    const res = await fetch(${JSON.stringify(SUPABASE_URL + '/rest/v1/tasks')}, {
      headers: { apikey: 'teste', Authorization: 'Bearer ' + session.access_token },
    });
    return { status: res.status, body: await res.text() };
  })()`);
  assert.equal(rls.status, 403, 'tarefas não podem ser lidas por conta pendente');
  record('RLS: conta pendente recebe 403 ao ler tarefas', true);

  // 3. Segundo usuário (para rejeição)
  await logout();
  await signupViaUi(USER_B, USER_PASS);
  record('segundo signup também nasce pendente', true);

  // 4. Admin aprova e rejeita
  await logout();
  await login(ADMIN_EMAIL, ADMIN_PASS);
  await waitFor(`location.pathname === '/'`);
  record('admin aprovado acessa o app normalmente', true);

  await goto('/admin');
  await waitFor(`!document.getElementById('adminContent').hidden`);
  assert.equal(await text('#statPending'), '2');
  record('admin vê a fila com 2 cadastros pendentes', true);

  await clickActionFor(USER_A, 'approve');
  await waitFor(`document.getElementById('statPending').textContent === '1'`);
  record('admin aprova o cadastro de Ana', true);

  await clickActionFor(USER_B, 'reject');
  await waitFor(`document.getElementById('rejectDialog').open`);
  await fill('#rejectReason', REJECT_REASON);
  await click('#rejectConfirm');
  await waitFor(`!document.getElementById('rejectDialog').open`);
  await waitFor(`document.getElementById('statBlocked').textContent === '1'`);
  record('admin rejeita Bruno e registra o motivo', true);

  // 5. Aprovado ganha acesso e cria tarefa
  await logout();
  await login(USER_A, USER_PASS);
  await waitFor(`location.pathname === '/'`);
  await waitFor(`!!document.getElementById('taskForm')`);
  await fill('#taskTitle', 'Tarefa do fluxo de aprovação');
  await fill('#taskDate', '2026-09-22');
  await submit('#taskForm');
  await waitFor(`document.querySelectorAll('.task-card').length === 1`);
  record('usuário aprovado entra no app e cria tarefa', true);

  const snapshot = await fetch(`http://127.0.0.1:${MOCK_PORT}/__test/snapshot`).then((r) => r.json());
  assert.ok(snapshot.tasks.some((t) => t.title === 'Tarefa do fluxo de aprovação' && t.owner_id === snapshot.users.find((u) => u.email === USER_A)?.id));
  assert.equal(snapshot.users.find((u) => u.email === USER_A).status, 'approved');
  record('tarefa persistida vinculada ao usuário aprovado', true);

  // 6. Rejeitado vê o motivo e fica sem acesso
  await logout();
  await login(USER_B, USER_PASS);
  await waitFor(`location.pathname === '/status'`);
  await waitFor(`!document.getElementById('blockedReason').hidden`);
  assert.equal(await text('#blockedReasonText'), REJECT_REASON);
  record('rejeitado vê a tela bloqueada com o motivo', true);

  // 7. Reabertura devolve para a fila + histórico
  await logout();
  await login(ADMIN_EMAIL, ADMIN_PASS);
  await waitFor(`location.pathname === '/'`);
  await goto('/admin');
  await waitFor(`!document.getElementById('adminContent').hidden`);
  await click('[data-tab="blocked"]');
  await waitFor(`[...document.querySelectorAll('.admin-item')].some((i) => i.querySelector('.admin-item-id strong')?.textContent === ${JSON.stringify(USER_B)})`);
  await clickActionFor(USER_B, 'reopen');
  await waitFor(`document.getElementById('statBlocked').textContent === '0' && document.getElementById('statPending').textContent === '1'`);
  record('admin reabre o cadastro bloqueado → volta para a fila', true);

  await click('[data-tab="history"]');
  await waitFor(`!document.getElementById('historyWrap').hidden`);
  const historyText = await evaluate(`document.getElementById('historyBody').innerText`);
  assert.match(historyText, /aprovado/i);
  assert.match(historyText, /rejeitado/i);
  assert.match(historyText, /reaberto/i);
  record('histórico registra aprovar, rejeitar e reabrir', true);

  // 8. Guard: usuário comum não acessa o painel
  await logout();
  await login(USER_A, USER_PASS);
  await waitFor(`location.pathname === '/'`);
  await goto('/admin');
  await waitFor(`!document.getElementById('accessDenied').hidden`);
  assert.match(await text('#deniedTitle'), /Acesso negado/);
  record('guard: usuário comum não acessa o painel admin', true);

  // 9. Reaberto volta a ser pendente para o usuário
  await logout();
  await login(USER_B, USER_PASS);
  await waitFor(`location.pathname === '/status'`);
  await waitFor(`!document.getElementById('pendingCard').hidden`);
  record('reaberto volta a ver a tela "em análise"', true);

  assert.deepEqual(runtimeErrors, [], 'nenhum erro de runtime na página');
  clearTimeout(watchdog);
} catch (error) {
  steps.push({ name: `FALHA: ${error.message}`, ok: false });
  let diagnostics = null;
  try {
    diagnostics = await evaluate(`(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('auth-token')) || null;
      return {
        href: location.href,
        path: location.pathname,
        registerError: document.getElementById('registerError')?.textContent || '',
        authError: document.getElementById('authError')?.textContent || '',
        visibleCard: [...document.querySelectorAll('.auth-card')].filter((c) => !c.hidden).map((c) => c.id),
        storageKey: key,
        storageValue: key ? localStorage.getItem(key).slice(0, 200) : null,
        pendingCardHidden: document.getElementById('pendingCard')?.hidden,
      };
    })()`);
  } catch {}
  diagnostics = diagnostics || {};
  steps.push({ name: `DIAGNÓSTICO: ${JSON.stringify({ ...diagnostics, traffic: traffic.slice(-30) })}`, ok: false });
}

ws.close();
chrome.kill();
server.kill();
mock.kill();

const passed = steps.filter((s) => s.ok).length;
console.log(JSON.stringify({
  ok: steps.every((s) => s.ok) && runtimeErrors.length === 0,
  steps,
  runtimeErrors,
}, null, 2));
process.exit(steps.every((s) => s.ok) && runtimeErrors.length === 0 ? 0 : 1);