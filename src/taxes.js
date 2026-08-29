export const TAX_TABLE_YEAR = 2026;
export const MINIMUM_WAGE_2026 = 1621;

const INSS_BRACKETS_2026 = Object.freeze([
  Object.freeze({ upper: 1621, rate: 0.075 }),
  Object.freeze({ upper: 2902.84, rate: 0.09 }),
  Object.freeze({ upper: 4354.27, rate: 0.12 }),
  Object.freeze({ upper: 8475.55, rate: 0.14 }),
]);

const IRRF_BRACKETS_2026 = Object.freeze([
  Object.freeze({ upper: 2428.8, rate: 0, deduction: 0 }),
  Object.freeze({ upper: 2826.65, rate: 0.075, deduction: 182.16 }),
  Object.freeze({ upper: 3751.05, rate: 0.15, deduction: 394.16 }),
  Object.freeze({ upper: 4664.68, rate: 0.225, deduction: 675.49 }),
  Object.freeze({ upper: Infinity, rate: 0.275, deduction: 908.73 }),
]);

const DEPENDENT_DEDUCTION_2026 = 189.59;
const SIMPLIFIED_DEDUCTION_2026 = 607.2;

function roundMoney(value) {
  const number = Number(value);
  return Math.round((number + (Number.EPSILON * Math.abs(number))) * 100) / 100;
}

function nonNegativeNumber(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${field} inválido.`);
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > 50) throw new TypeError(`${field} inválido.`);
  return number;
}

function findBracket(base, brackets) {
  return brackets.find((bracket) => base <= bracket.upper) || brackets[brackets.length - 1];
}

export function calculateInss2026(base) {
  const taxableBase = nonNegativeNumber(base, 'Base do INSS');
  let previousUpper = 0;
  let value = 0;

  for (const bracket of INSS_BRACKETS_2026) {
    if (taxableBase <= previousUpper) break;
    const portion = Math.min(taxableBase, bracket.upper) - previousUpper;
    value += portion * bracket.rate;
    previousUpper = bracket.upper;
  }

  return Object.freeze({
    year: TAX_TABLE_YEAR,
    base: roundMoney(taxableBase),
    value: roundMoney(value),
  });
}

export function calculateIrrf2026({ gross, inss = 0, dependents = 0, useSimplifiedDeduction = true } = {}) {
  const taxableGross = nonNegativeNumber(gross, 'Rendimento tributável');
  const inssDeduction = nonNegativeNumber(inss, 'Desconto de INSS');
  const dependentCount = nonNegativeInteger(dependents, 'Número de dependentes');
  if (typeof useSimplifiedDeduction !== 'boolean') throw new TypeError('Opção de dedução simplificada inválida.');

  const legalDeduction = inssDeduction + (dependentCount * DEPENDENT_DEDUCTION_2026);
  const simplifiedDeduction = useSimplifiedDeduction ? SIMPLIFIED_DEDUCTION_2026 : 0;
  const deduction = Math.max(legalDeduction, simplifiedDeduction);
  const calculationBase = Math.max(0, taxableGross - deduction);
  const bracket = findBracket(calculationBase, IRRF_BRACKETS_2026);
  const beforeReduction = Math.max(0, (calculationBase * bracket.rate) - bracket.deduction);

  let reduction = 0;
  if (taxableGross <= 5000) reduction = 312.89;
  else if (taxableGross <= 7350) reduction = Math.max(0, 978.62 - (0.133145 * taxableGross));

  return Object.freeze({
    year: TAX_TABLE_YEAR,
    gross: roundMoney(taxableGross),
    inssDeduction: roundMoney(inssDeduction),
    dependents: dependentCount,
    legalDeduction: roundMoney(legalDeduction),
    simplifiedDeduction: roundMoney(simplifiedDeduction),
    deductionUsed: roundMoney(deduction),
    base: roundMoney(calculationBase),
    rate: bracket.rate,
    taxBeforeReduction: roundMoney(beforeReduction),
    reduction: roundMoney(Math.min(reduction, beforeReduction)),
    value: roundMoney(Math.max(0, beforeReduction - reduction)),
  });
}
