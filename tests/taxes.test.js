import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInss2026, calculateIrrf2026 } from '../src/taxes.js';

test('calcula o INSS progressivo de 2026 em faixas e limita no teto', () => {
  assert.equal(calculateInss2026(1621).value, 121.58);
  assert.equal(calculateInss2026(3000).value, 248.60);
  assert.equal(calculateInss2026(10000).value, 988.09);
});

test('calcula o IRRF mensal de 2026 com dedução simplificada e redução', () => {
  const result = calculateIrrf2026({ gross: 5000, inss: 509.60, dependents: 0 });

  assert.equal(result.base, 4392.80);
  assert.equal(result.deductionUsed, 607.20);
  assert.equal(result.reduction, 312.89);
  assert.equal(result.value, 0);
});

test('seleciona cada faixa progressiva do IRRF de 2026', () => {
  assert.equal(calculateIrrf2026({ gross: 2428.80 }).rate, 0);
  assert.equal(calculateIrrf2026({ gross: 3107.20 }).rate, 0.075);
  assert.equal(calculateIrrf2026({ gross: 3607.20 }).rate, 0.15);
  assert.equal(calculateIrrf2026({ gross: 5000 }).rate, 0.225);
  assert.equal(calculateIrrf2026({ gross: 6000 }).rate, 0.275);
});

test('aplica a dedução por dependentes e separa a base do 13º', () => {
  const withoutDependents = calculateIrrf2026({ gross: 6000, inss: 649.60, dependents: 0 });
  const withDependents = calculateIrrf2026({ gross: 6000, inss: 649.60, dependents: 2, useSimplifiedDeduction: false });

  assert.equal(withoutDependents.value, 382.88);
  assert.equal(withDependents.legalDeduction, 1028.78);
  assert.equal(withDependents.base, 4971.22);
  assert.equal(withDependents.value, 278.61);
});

test('rejeita bases, dependentes e opções tributárias inválidas', () => {
  assert.throws(() => calculateInss2026(-1), /base do inss/i);
  assert.throws(() => calculateIrrf2026({ gross: 1, dependents: 1.5 }), /dependentes/i);
  assert.throws(() => calculateIrrf2026({ gross: 1, useSimplifiedDeduction: 'sim' }), /dedução simplificada/i);
});
