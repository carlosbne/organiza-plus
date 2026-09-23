// Servidor de desenvolvimento estático para o Organiza+ (sem dependências).
// Mapeia rotas sem extensão para .html (como o netlify.toml), ex.:
//   /status  -> status.html
//   /admin   -> admin.html
//   /auth    -> auth.html
// Uso:
//   node scripts/serve.mjs               # serve a raiz na porta 4173
//   node scripts/serve.mjs --dist        # serve dist/ na porta 4174
//   node scripts/serve.mjs --port 8080   # porta personalizada
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const isDist = args.includes('--dist');
const portFlag = args.indexOf('--port');
const PORT = Number(args[portFlag + 1]) || (isDist ? 4174 : 4173);

const BASE = join(ROOT, isDist ? 'dist' : '');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  let data;
  let type = 'application/octet-stream';
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let fileName = pathname === '/' ? '/index.html' : pathname;
    // Rotas limpas do app (sem extensão) apontam para o .html correspondente.
    if (!extname(fileName) && (fileName.startsWith('/admin') || fileName.startsWith('/status')
      || fileName.startsWith('/auth') || fileName.startsWith('/consultas'))) {
      fileName = `${fileName}.html`;
    }
    const filePath = normalize(join(BASE, fileName));
    if (!filePath.startsWith(BASE)) throw new Error('fora do diretório');
    data = await readFile(filePath);
    type = MIME[extname(filePath)] || type;
  } catch {
    if (!res.headersSent) res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
    return;
  }
  if (!res.headersSent) res.writeHead(200, { 'content-type': type });
  res.end(data);
});

server.listen(PORT, () => {
  console.log(`Organiza+ (${isDist ? 'dist' : 'raiz'}) em http://127.0.0.1:${PORT}`);
});