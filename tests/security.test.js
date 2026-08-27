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

test('simulador de rescisão expõe as opções adicionais do cenário de referência', async () => {
  const home = await source('index.html');
  for (const field of ['terminationEmployeeName', 'terminationMinimumWage', 'terminationInsalubrity', 'terminationHazardous', 'terminationDependents']) {
    assert.match(home, new RegExp(`id=["']${field}["']`));
  }
  assert.match(home, /value="10"[^>]*>Grau mínimo/);
  assert.match(home, /value="20"[^>]*>Grau médio/);
  assert.match(home, /value="40"[^>]*>Grau máximo/);
  assert.match(home, /value="30"[^>]*>30% do salário-base/);
});

test('JavaScript evita APIs que permitem injeção de HTML ou execução dinâmica', async () => {
  for (const file of ['src/app.js', 'src/consultas.js', 'src/auth.js', 'src/core.js', 'src/supabase.js', 'src/termination.js', 'src/taxes.js']) {
    const javascript = await source(file);
    assert.doesNotMatch(javascript, /\.(innerHTML|outerHTML)\s*=/, file);
    assert.doesNotMatch(javascript, /insertAdjacentHTML|document\.write|\beval\s*\(|new Function/, file);
  }
  const app = await source('src/app.js');
  assert.match(app, /textContent/);
});

test('links externos são abertos sem acesso a window.opener', async () => {
  const app = await source('src/app.js');
  assert.match(app, /noopener,noreferrer/);
});

test('frontend não contém credenciais privilegiadas do Supabase', async () => {
  for (const file of ['src/config.js', 'src/supabase.js', '.env.example']) {
    const javascript = await source(file);
    assert.doesNotMatch(javascript, /service[_-]?role|SUPABASE_SERVICE_ROLE/i, file);
  }
});
