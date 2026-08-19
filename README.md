# Organiza+ — Protótipo

Protótipo local, simples e minimalista para a rotina de Departamento Pessoal. Foi construído sem frameworks e sem dependências de produção para consumir poucos recursos.

## Recursos

- Gestão de tarefas com prazo, empresa, prioridade, observações, filtros e indicadores.
- Persistência local no navegador, sem envio de dados a servidores externos.
- Calculadora de horas extras, adicional noturno com hora reduzida e DSR.
- Simulador mensal de custo de contratação por regime tributário.
- Manual de dúvidas frequentes, FGTS Digital, rescisão e seguro-desemprego.
- Layout responsivo e navegação por teclado.

## Como abrir no Windows

Dê dois cliques em `iniciar-organiza-plus.bat`. O sistema abrirá em:

`http://127.0.0.1:4173`

Alternativamente, no terminal:

```bash
npm run serve
```

## Testes

```bash
npm test
npm run test:security
```

O teste de ponta a ponta (`tests/e2e.mjs`) usa o Chrome via DevTools e foi executado durante a entrega.

## Privacidade e segurança

- Os dados das tarefas ficam no `localStorage` do navegador.
- Conteúdo digitado é inserido com `textContent`, não como HTML.
- A aplicação não usa `eval`, manipuladores inline ou dependências JavaScript externas.
- A política CSP restringe scripts e conexões à própria aplicação.
- Links para o Google Agenda usam `noopener,noreferrer`.

## Observação técnica e legal

Os cálculos são estimativas de apoio. Alíquotas como RAT/FAP, terceiros, regras do Simples Nacional, incidências e convenções coletivas podem variar. Revise os parâmetros e confirme a legislação vigente antes de produzir documentos oficiais ou apresentar valores ao cliente.
