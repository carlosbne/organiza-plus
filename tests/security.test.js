import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('páginas HTML definem CSP restritiva e não carregam scripts de terceiros', async () => {
  for (const page of ['index.html', 'consultas.html']) {
    const html = await source(page);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'self'/);
    assert.match(html, /script-src 'self'/);
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  }
});

test('interfaces não usam manipuladores inline e Consultas fica separada da página principal', async () => {
  const home = await source('index.html');
  const consultations = await source('consultas.html');
  assert.doesNotMatch(home, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(consultations, /\son[a-z]+\s*=/i);
  assert.match(home, /href=["']\.\/consultas["']/);
  assert.doesNotMatch(home, /id=["'](?:manualDialog|fgtsDialog|proceduresDialog)["']/);
  assert.match(consultations, /id=["'](?:manualDialog|fgtsDialog|proceduresDialog)["']/);
});

test('JavaScript evita APIs que permitem injeção de HTML ou execução dinâmica', async () => {
  const app = await source('src/app.js');
  const consultations = await source('src/consultas.js');
  assert.doesNotMatch(app, /\.(innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(app, /insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
  assert.match(app, /textContent/);
  assert.doesNotMatch(consultations, /\.(innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(consultations, /insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
});

test('links externos são abertos sem acesso a window.opener', async () => {
  const app = await source('src/app.js');
  assert.match(app, /noopener,noreferrer/);
});
