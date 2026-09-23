import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });

// Garante src/config.local.js para o bundle SEM credenciais versionadas.
//  - Se SUPABASE_URL/SUPABASE_ANON_KEY estiverem no ambiente (ex.: Netlify),
//    gera o arquivo com esses valores.
//  - Caso contrário, se o arquivo não existir, gera vazio ("modo local").
//  - src/config.local.js está no .gitignore e nunca entra no repositório.
const configLocalPath = new URL('src/config.local.js', import.meta.url);
try {
  await readFile(configLocalPath);
} catch {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';
  await writeFile(
    configLocalPath,
    `export const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_ANON_KEY = ${JSON.stringify(key)};\n`,
    'utf8',
  );
}

for (const file of ['index.html', 'consultas.html', 'auth.html', 'status.html', 'admin.html', 'styles.css', 'auth.css', 'favicon.svg', 'brand.svg']) {
  await cp(file, `dist/${file}`);
}

for (const entry of ['src/app.js', 'src/consultas.js', 'src/auth.js', 'src/status.js', 'src/admin.js']) {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: `dist/${entry}`,
  });
}
