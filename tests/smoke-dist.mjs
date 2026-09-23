// Smoke test do build (dist/) para o fluxo de aprovação.
// Sobe o servidor de desenvolvimento real (scripts/serve.mjs --dist) para
// validar o mapeamento das rotas sem extensão e verifica no Chrome headless:
//   - páginas carregam sem erros de runtime;
//   - rotas protegidas redirecionam para /auth quando não há sessão.
// Uso: node tests/smoke-dist.mjs
// Exit codes: 0 = ok, 1 = falhou, 2 = ambiente sem navegador (não testou).
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4173;
const DEBUG_PORT = 9223;
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

let chromePath = CHROME_PATHS.find((path) => {
  try { access(path); return true; } catch { return false; }
});
if (!chromePath) {
  console.log(JSON.stringify({ ok: false, skipped: true, reason: 'Chrome/Edge não encontrado' }, null, 2));
  process.exit(2);
}

const server = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs'), '--dist', '--port', String(PORT)], { stdio: 'ignore' });
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/auth`)).ok) break; } catch {}
  await sleep(200);
}
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) break; } catch {}
  await sleep(200);
}

const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });

let seq = 0;
const pending = new Map();
const runtimeErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') runtimeErrors.push(m.params.exceptionDetails.text);
});
const cmd = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
};
await cmd('Page.enable');
await cmd('Runtime.enable');

const routes = ['/', '/auth', '/status', '/admin', '/consultas'];
const results = [];
for (const route of routes) {
  runtimeErrors.length = 0;
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}${route}` });
  await sleep(1800);
  const state = await cmd('Runtime.evaluate', {
    expression: `({ url: location.pathname, title: document.title, hasLoginForm: !!document.getElementById('authForm') })`,
    returnByValue: true,
  });
  results.push({ route, finalPath: state.result.value.url, hasLoginForm: state.result.value.hasLoginForm, runtimeErrors: [...runtimeErrors] });
}

ws.close();
chrome.kill();
server.kill();

const expectedFiles = ['status.html', 'admin.html', 'src/status.js', 'src/admin.js'];
const missing = [];
for (const file of expectedFiles) {
  try { await access(join(DIST, file)); } catch { missing.push(file); }
}

const failures = [];
for (const r of results) {
  if (r.runtimeErrors.length) failures.push(`${r.route}: erros de runtime ${JSON.stringify(r.runtimeErrors)}`);
}
if (missing.length) failures.push(`arquivos ausentes no dist: ${missing.join(', ')}`);
for (const route of ['/', '/status', '/admin', '/consultas']) {
  const r = results.find((item) => item.route === route);
  if (!r || !r.finalPath.includes('/auth')) failures.push(`${route}: esperava redirecionamento para /auth, obteve ${r?.finalPath}`);
}
const auth = results.find((item) => item.route === '/auth');
if (!auth?.hasLoginForm) failures.push('/auth: formulário de login não renderizado');

console.log(JSON.stringify({
  ok: failures.length === 0,
  results,
  missingFiles: missing,
  failures,
}, null, 2));
process.exit(failures.length ? 1 : 0);