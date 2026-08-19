import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('HTML define CSP restritiva e não carrega scripts de terceiros', async () => {
  const html = await source('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
});

test('interface não usa manipuladores inline', async () => {
  const html = await source('index.html');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test('JavaScript evita APIs que permitem injeção de HTML ou execução dinâmica', async () => {
  const app = await source('src/app.js');
  assert.doesNotMatch(app, /\.(innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(app, /insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
  assert.match(app, /textContent/);
});

test('links externos são abertos sem acesso a window.opener', async () => {
  const app = await source('src/app.js');
  assert.match(app, /noopener,noreferrer/);
});
