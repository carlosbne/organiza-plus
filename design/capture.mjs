// Captura screenshots dos mockups de design do fluxo de aprovação.
// Uso: node design/capture.mjs   (gera PNG em design/shots/)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 4173;
const DEBUG_PORT = 9223;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MOCKUPS = [
  'design/01-status-pendente.html',
  'design/02-status-bloqueado.html',
  'design/03-admin-painel.html',
  'design/04-admin-modal-rejeicao.html',
  'design/05-acesso-negado.html',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = normalize(join(ROOT, pathname === '/' ? '/index.html' : pathname));
    if (!filePath.startsWith(ROOT)) throw new Error('fora do diretório');
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  `--remote-debugging-port=${DEBUG_PORT}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDebugger() {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome não respondeu no endpoint de debugging.');
}

await waitForDebugger();
const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('Nenhuma página encontrada no Chrome.');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});

function command(method, params = {}) {
  const id = ++sequence;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await command('Page.enable');
await command('Runtime.enable');

const shotsDir = join(ROOT, 'design', 'shots');
await mkdir(shotsDir, { recursive: true });

const saved = [];
for (const route of MOCKUPS) {
  const url = `http://127.0.0.1:${PORT}/${route}`;
  await command('Page.navigate', { url });
  await new Promise((resolve) => {
    const onLoad = () => { ws.removeEventListener('message', onLoad); resolve(); };
    ws.addEventListener('message', onLoad);
    setTimeout(resolve, 8000);
  });
  await sleep(1200);

  const layout = await command('Page.getLayoutMetrics');
  const { width, height } = layout.cssContentSize;
  await command('Emulation.setDeviceMetricsOverride', {
    width: Math.max(1440, Math.ceil(width)),
    height: Math.max(1000, Math.ceil(height) + 160),
    deviceScaleFactor: 2,
    mobile: false,
  });
  await sleep(300);

  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const name = route.split('/').pop().replace('.html', '.png');
  await writeFile(join(shotsDir, name), Buffer.from(shot.data, 'base64'));
  saved.push(name);
}

ws.close();
chrome.kill();
server.close();

console.log(JSON.stringify({ ok: true, saved }, null, 2));