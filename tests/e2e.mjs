import assert from 'node:assert/strict';

const targets = await fetch('http://127.0.0.1:9223/json/list').then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url === 'http://127.0.0.1:4173/');
assert.ok(target, 'Página Organiza+ não encontrada no Chrome.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
const browserErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text);
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

await command('Runtime.enable');
await command('Log.enable');
await evaluate('localStorage.clear()');
await command('Page.navigate', { url: 'about:blank' });
await new Promise((resolve) => setTimeout(resolve, 100));
runtimeErrors.length = 0;
browserErrors.length = 0;
await command('Page.navigate', { url: 'http://127.0.0.1:4173/' });
await new Promise((resolve) => setTimeout(resolve, 500));

const created = await evaluate(`(async () => {
  const set = (id, value) => {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('taskTitle', 'Fechar folha <img src=x onerror=alert(1)>');
  set('taskDate', '2026-08-20');
  set('companyCode', '001');
  set('companyName', '<svg onload=alert(1)>Empresa teste');
  set('taskNotes', 'Conferir FGTS e encargos');
  document.getElementById('taskForm').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 80));
  return {
    cards: document.querySelectorAll('.task-card').length,
    title: document.querySelector('.task-title')?.textContent,
    injectedMedia: document.querySelectorAll('.task-card img, .task-card svg, .task-card script').length,
    pending: document.getElementById('pendingCount').textContent,
    persisted: JSON.parse(localStorage.getItem('organizaPlus.tasks.v3'))[0].title,
    calculationReady: document.getElementById('calcResult').textContent.includes('Total de adicionais'),
    costReady: document.getElementById('costSummary').textContent.includes('Custo mensal estimado'),
  };
})()`);

assert.equal(created.cards, 1);
assert.equal(created.title, 'Fechar folha <img src=x onerror=alert(1)>');
assert.equal(created.injectedMedia, 0, 'Conteúdo do usuário foi interpretado como HTML.');
assert.equal(created.pending, '1');
assert.equal(created.persisted, created.title);
assert.equal(created.calculationReady, true);
assert.equal(created.costReady, true);

const completed = await evaluate(`(async () => {
  document.querySelector('[data-action="complete"]').click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  document.querySelector('[data-dialog="manualDialog"]').click();
  return {
    done: document.getElementById('doneCount').textContent,
    efficiency: document.getElementById('rate').textContent,
    dialogOpen: document.getElementById('manualDialog').open,
  };
})()`);

assert.deepEqual(completed, { done: '1', efficiency: '100%', dialogOpen: true });
assert.deepEqual(runtimeErrors, []);
assert.deepEqual(browserErrors, []);

console.log(JSON.stringify({
  status: 'ok',
  checks: {
    taskCreatedAndPersisted: true,
    taskCompletedAndMetricsUpdated: true,
    calculatorsRendered: true,
    manualDialogOpened: true,
    xssPayloadRenderedAsText: true,
    runtimeErrors: 0,
    browserErrors: 0,
  },
}, null, 2));

socket.close();
