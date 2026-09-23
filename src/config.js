// Valores reais do Supabase NÃO ficam neste arquivo (repositório público).
//
// Como configurar (local de desenvolvimento):
//   1) Copie src/config.local.example.js para src/config.local.js
//   2) Preencha com os valores do seu projeto Supabase
//   3) O arquivo src/config.local.js está no .gitignore — nunca é versionado.
//
// No build (Netlify etc.): defina as variáveis de ambiente SUPABASE_URL e
// SUPABASE_ANON_KEY na plataforma — o build.mjs gera o config.local.js com
// esses valores antes de empacotar. Sem elas, o build sai em "modo local"
// (sem Supabase), sem nenhuma credencial embutida.
export { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.local.js';