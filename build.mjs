import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });

for (const file of ['index.html', 'auth.html', 'styles.css', 'auth.css', 'favicon.svg', 'brand.svg']) {
  await cp(file, `dist/${file}`);
}

for (const entry of ['src/app.js', 'src/auth.js']) {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: `dist/${entry}`,
  });
}
