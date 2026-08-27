import {
  calculateInss2026,
  calculateIrrf2026,
  MINIMUM_WAGE_2026,
  TAX_TABLE_YEAR,
} from './taxes.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const REMUNERATION_PARTS = Object.freeze(['base', 'insalubrity', 'periculosidade', 'additional']);

export const TERMINATION_TYPES = Object.freeze({
  sem_justa_causa: 'Dispensa sem justa causa',
  pedido_demissao: 'Pedido de demissão',
  com_justa_causa: 'Dispensa por justa causa',
  acordo_484a: 'Rescisão por acordo (art. 484-A)',
});

export const NOTICE_MODES = Object.freeze({
  indenizado: 'Indenizado',
  trabalhado: 'Trabalhado',
  dispensado: 'Dispensado do cumprimento',
  descontado: 'Descontado do empregado',
  nao_aplicavel: 'Não aplicável',
});

export const INSALUBRITY_RATES = Object.freeze([0, 10, 20, 40]);
export const HAZARDOUS_RATES = Object.freeze([0, 30]);

const VALID_NOTICE_MODES = Object.freeze({
  sem_justa_causa: Object.freeze(['indenizado', 'trabalhado']),
  pedido_demissao: Object.freeze(['trabalhado', 'dispensado', 'descontado']),
  com_justa_causa: Object.freeze(['nao_aplicavel']),
  acordo_484a: Object.freeze(['indenizado', 'trabalhado']),
});

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${field} inválido.`);
  return number;
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

function oneOfNumber(value, options, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || !options.includes(number)) throw new TypeError(`${field} inválida.`);
  return number;
}

function cleanEmployeeName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 120);
}

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month, day));
}

export function parseDateKey(value, field = 'Data') {
  const text = String(value ?? '').trim();
  const match = DATE_PATTERN.exec(text);
  if (!match) throw new TypeError(`${field} inválida.`);
  const [, year, month, day] = match.map(Number);
  const date = utcDate(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError(`${field} inválida.`);
  }
  return date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function compareDates(left, right) {
  return left.getTime() - right.getTime();
}

function daysInMonth(year, month) {
  return utcDate(year, month + 1, 0).getUTCDate();
}

export function addCalendarDays(date, days) {
  const source = date instanceof Date ? date : parseDateKey(date);
  return new Date(source.getTime() + (days * DAY_MS));
}

function firstOfMonth(year, month) {
  return utcDate(year, month, 1);
}

function lastOfMonth(year, month) {
  return utcDate(year, month + 1, 0);
}

function nextMonth(date) {
  return firstOfMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function maxDate(left, right) {
  return compareDates(left, right) >= 0 ? left : right;
}

function minDate(left, right) {
  return compareDates(left, right) <= 0 ? left : right;
}

function countMonthsWithAtLeastFifteenDays(start, end) {
  if (compareDates(start, end) > 0) return 0;
  let count = 0;
  let cursor = firstOfMonth(start.getUTCFullYear(), start.getUTCMonth());

  while (compareDates(cursor, end) <= 0) {
    const monthStart = maxDate(start, cursor);
    const monthEnd = minDate(end, lastOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth()));
    const daysWorked = Math.floor((monthEnd.getTime() - monthStart.getTime()) / DAY_MS) + 1;
    if (daysWorked >= 15) count += 1;
    cursor = nextMonth(cursor);
  }

  return count;
}

function anniversaryForYear(admissionDate, year) {
  const month = admissionDate.getUTCMonth();
  const day = Math.min(admissionDate.getUTCDate(), daysInMonth(year, month));
  return utcDate(year, month, day);
}

function currentVacationPeriodStart(admissionDate, endDate) {
  let anniversary = anniversaryForYear(admissionDate, endDate.getUTCFullYear());
  if (compareDates(anniversary, endDate) > 0) anniversary = anniversaryForYear(admissionDate, endDate.getUTCFullYear() - 1);
  return maxDate(anniversary, admissionDate);
}

export function completeServiceYears(admissionDate, endDate) {
  const start = admissionDate instanceof Date ? admissionDate : parseDateKey(admissionDate, 'Admissão');
  const end = endDate instanceof Date ? endDate : parseDateKey(endDate, 'Desligamento');
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  if (compareDates(anniversaryForYear(start, start.getUTCFullYear() + years), end) > 0) years -= 1;
  return Math.max(0, years);
}

export function noticeDaysForService(serviceYears) {
  const years = Number(serviceYears);
  if (!Number.isInteger(years) || years < 0) throw new TypeError('Anos de serviço inválidos.');
  return Math.min(90, 30 + (Math.min(years, 20) * 3));
}

export function countThirteenthMonths(admissionDate, endDate, year) {
  const start = admissionDate instanceof Date ? admissionDate : parseDateKey(admissionDate, 'Admissão');
  const end = endDate instanceof Date ? endDate : parseDateKey(endDate, 'Desligamento');
  const targetYear = year === undefined ? end.getUTCFullYear() : Number(year);
  if (!Number.isInteger(targetYear) || targetYear < 1900 || targetYear > 2200) throw new TypeError('Ano inválido.');
  const yearStart = firstOfMonth(targetYear, 0);
  const yearEnd = lastOfMonth(targetYear, 11);
  return countMonthsWithAtLeastFifteenDays(maxDate(start, yearStart), minDate(end, yearEnd));
}

export function countVacationProportionalMonths(admissionDate, endDate) {
  const start = admissionDate instanceof Date ? admissionDate : parseDateKey(admissionDate, 'Admissão');
  const end = endDate instanceof Date ? endDate : parseDateKey(endDate, 'Desligamento');
  return countMonthsWithAtLeastFifteenDays(currentVacationPeriodStart(start, end), end);
}

function sumParts(parts) {
  return REMUNERATION_PARTS.reduce((total, part) => total + parts[part], 0);
}

function scaleParts(parts, factor) {
  return REMUNERATION_PARTS.reduce((scaled, part) => {
    scaled[part] = parts[part] * factor;
    return scaled;
  }, {});
}

function roundedParts(parts) {
  return REMUNERATION_PARTS.reduce((rounded, part) => {
    rounded[part] = roundMoney(parts[part]);
    return rounded;
  }, {});
}

function countThirteenthMonthsThroughProjection(admissionDate, projectedDate, terminationDate) {
  if (compareDates(projectedDate, terminationDate) <= 0) return 0;
  let projectedCount = 0;
  for (let year = terminationDate.getUTCFullYear(); year <= projectedDate.getUTCFullYear(); year += 1) {
    projectedCount += countThirteenthMonths(admissionDate, projectedDate, year);
  }
  const currentCount = countThirteenthMonths(admissionDate, terminationDate, terminationDate.getUTCFullYear());
  return Math.max(0, projectedCount - currentCount);
}

function noticeConfiguration(type, mode, remunerationParts, statutoryNoticeDays) {
  const validModes = VALID_NOTICE_MODES[type];
  if (!validModes?.includes(mode)) throw new TypeError('Modalidade de aviso-prévio incompatível com o desligamento.');

  if (type === 'sem_justa_causa' && mode === 'indenizado') {
    const noticePayParts = scaleParts(remunerationParts, statutoryNoticeDays / 30);
    return { noticePayParts, noticeDeductionParts: scaleParts(remunerationParts, 0), projectionDays: statutoryNoticeDays };
  }
  if (type === 'acordo_484a' && mode === 'indenizado') {
    const halfNotice = statutoryNoticeDays / 2;
    const noticePayParts = scaleParts(remunerationParts, halfNotice / 30);
    return { noticePayParts, noticeDeductionParts: scaleParts(remunerationParts, 0), projectionDays: Math.round(halfNotice) };
  }
  if (type === 'pedido_demissao' && mode === 'descontado') {
    const noticeDeductionParts = scaleParts(remunerationParts, Math.min(30, statutoryNoticeDays) / 30);
    return { noticePayParts: scaleParts(remunerationParts, 0), noticeDeductionParts, projectionDays: 0 };
  }
  return { noticePayParts: scaleParts(remunerationParts, 0), noticeDeductionParts: scaleParts(remunerationParts, 0), projectionDays: 0 };
}

export function calculateTerminationSettlement(input = {}) {
  const type = String(input.terminationType || '').trim();
  if (!Object.hasOwn(TERMINATION_TYPES, type)) throw new TypeError('Tipo de desligamento inválido.');

  const mode = String(input.noticeMode || '').trim();
  const admissionDate = parseDateKey(input.admissionDate, 'Data de admissão');
  const terminationDate = parseDateKey(input.terminationDate, 'Data do desligamento');
  if (compareDates(terminationDate, admissionDate) < 0) throw new TypeError('O desligamento não pode ocorrer antes da admissão.');

  const employeeName = cleanEmployeeName(input.employeeName);
  const salary = positiveNumber(input.salary, 'Salário-base');
  const additionalMonthlyAverage = nonNegativeNumber(input.additionalMonthlyAverage, 'Média de adicionais');
  const minimumWage = positiveNumber(input.minimumWage ?? MINIMUM_WAGE_2026, 'Salário mínimo');
  const insalubrityPercent = oneOfNumber(input.insalubrityPercent, INSALUBRITY_RATES, 'Percentual de insalubridade');
  const hazardousPercent = oneOfNumber(input.hazardousPercent, HAZARDOUS_RATES, 'Percentual de periculosidade');
  if (insalubrityPercent > 0 && hazardousPercent > 0) {
    throw new TypeError('Selecione insalubridade ou periculosidade; os adicionais não são acumulados nesta estimativa.');
  }
  const dependents = nonNegativeInteger(input.dependents, 'Número de dependentes');
  const vacationPeriodsDue = nonNegativeInteger(input.vacationPeriodsDue, 'Férias vencidas');
  const vacationPeriodsDouble = nonNegativeInteger(input.vacationPeriodsDouble, 'Férias em dobro');
  const fgtsBalance = nonNegativeNumber(input.fgtsBalance, 'Saldo do FGTS');

  const insalubrityValue = minimumWage * (insalubrityPercent / 100);
  const hazardousValue = salary * (hazardousPercent / 100);
  const remunerationParts = {
    base: salary,
    insalubrity: insalubrityValue,
    periculosidade: hazardousValue,
    additional: additionalMonthlyAverage,
  };
  const remuneration = sumParts(remunerationParts);

  const serviceYears = completeServiceYears(admissionDate, terminationDate);
  const statutoryNoticeDays = type === 'pedido_demissao'
    ? 30
    : type === 'com_justa_causa'
      ? 0
      : noticeDaysForService(serviceYears);
  const notice = noticeConfiguration(type, mode, remunerationParts, statutoryNoticeDays);
  const projectedTerminationDate = addCalendarDays(terminationDate, notice.projectionDays);

  const salaryBalanceParts = scaleParts(remunerationParts, terminationDate.getUTCDate() / 30);
  const salaryBalance = sumParts(salaryBalanceParts);
  const noticePay = sumParts(notice.noticePayParts);
  const noticeDeduction = sumParts(notice.noticeDeductionParts);

  const thirteenthCurrentMonths = type === 'com_justa_causa'
    ? 0
    : countThirteenthMonths(admissionDate, terminationDate, terminationDate.getUTCFullYear());
  const thirteenthNoticeMonths = type === 'com_justa_causa'
    ? 0
    : countThirteenthMonthsThroughProjection(admissionDate, projectedTerminationDate, terminationDate);
  const thirteenthMonths = thirteenthCurrentMonths + thirteenthNoticeMonths;
  const thirteenthCurrentParts = scaleParts(remunerationParts, thirteenthCurrentMonths / 12);
  const thirteenthNoticeProjectionParts = scaleParts(remunerationParts, thirteenthNoticeMonths / 12);
  const thirteenthCurrent = sumParts(thirteenthCurrentParts);
  const thirteenthNoticeProjection = sumParts(thirteenthNoticeProjectionParts);
  const thirteenthProportional = thirteenthCurrent + thirteenthNoticeProjection;

  const vacationCurrentMonths = type === 'com_justa_causa'
    ? 0
    : countVacationProportionalMonths(admissionDate, terminationDate);
  const vacationNoticeMonths = type === 'com_justa_causa'
    ? 0
    : Math.max(0, countVacationProportionalMonths(admissionDate, projectedTerminationDate) - vacationCurrentMonths);
  const vacationProportionalMonths = vacationCurrentMonths + vacationNoticeMonths;
  const vacationCurrentParts = scaleParts(remunerationParts, vacationCurrentMonths / 12);
  const vacationNoticeProjectionParts = scaleParts(remunerationParts, vacationNoticeMonths / 12);
  const vacationCurrentBase = sumParts(vacationCurrentParts);
  const vacationNoticeProjectionBase = sumParts(vacationNoticeProjectionParts);
  const vacationProportionalBase = vacationCurrentBase + vacationNoticeProjectionBase;
  const vacationProportionalThird = vacationProportionalBase / 3;
  const vacationDueSimpleBase = remuneration * vacationPeriodsDue;
  const vacationDueSimpleThird = vacationDueSimpleBase / 3;
  const vacationDueDoubleBase = remuneration * 2 * vacationPeriodsDouble;
  const vacationDueDoubleThird = vacationDueDoubleBase / 3;

  const totalGross = salaryBalance
    + noticePay
    + thirteenthProportional
    + vacationProportionalBase
    + vacationProportionalThird
    + vacationDueSimpleBase
    + vacationDueSimpleThird
    + vacationDueDoubleBase
    + vacationDueDoubleThird;
  const directSettlement = totalGross - noticeDeduction;

  const inssSalary = calculateInss2026(salaryBalance);
  const inssThirteenth = calculateInss2026(thirteenthCurrent);
  const irrfSalary = calculateIrrf2026({ gross: salaryBalance, inss: inssSalary.value, dependents });
  const irrfThirteenth = calculateIrrf2026({
    gross: thirteenthCurrent,
    inss: inssThirteenth.value,
    dependents,
    useSimplifiedDeduction: false,
  });
  const inssTotal = inssSalary.value + inssThirteenth.value;
  const irrfTotal = irrfSalary.value + irrfThirteenth.value;
  const totalDeductions = noticeDeduction + inssTotal + irrfTotal;
  const estimatedNet = totalGross - totalDeductions;

  const fgtsFinePercent = type === 'sem_justa_causa' ? 40 : type === 'acordo_484a' ? 20 : 0;
  const fgtsWithdrawalPercent = type === 'sem_justa_causa' ? 100 : type === 'acordo_484a' ? 80 : 0;
  const fgtsFine = fgtsBalance * (fgtsFinePercent / 100);
  const fgtsWithdrawal = fgtsBalance * (fgtsWithdrawalPercent / 100);
  const roundedSalaryBalanceParts = roundedParts(salaryBalanceParts);
  const roundedNoticePayParts = roundedParts(notice.noticePayParts);
  const roundedNoticeDeductionParts = roundedParts(notice.noticeDeductionParts);

  return {
    employeeName,
    terminationType: type,
    terminationTypeLabel: TERMINATION_TYPES[type],
    noticeMode: mode,
    noticeModeLabel: NOTICE_MODES[mode],
    admissionDate: dateKey(admissionDate),
    terminationDate: dateKey(terminationDate),
    projectedTerminationDate: dateKey(projectedTerminationDate),
    salary: roundMoney(salary),
    minimumWage: roundMoney(minimumWage),
    additionalMonthlyAverage: roundMoney(additionalMonthlyAverage),
    dependents,
    insalubrityPercent,
    insalubrityValue: roundMoney(insalubrityValue),
    hazardousPercent,
    hazardousValue: roundMoney(hazardousValue),
    remuneration: roundMoney(remuneration),
    serviceYears,
    noticeDays: statutoryNoticeDays,
    projectedNoticeDays: notice.projectionDays,
    salaryBalanceBase: roundedSalaryBalanceParts.base,
    salaryBalanceInsalubrity: roundedSalaryBalanceParts.insalubrity,
    salaryBalancePericulosidade: roundedSalaryBalanceParts.periculosidade,
    salaryBalanceAdditional: roundedSalaryBalanceParts.additional,
    salaryBalance: roundMoney(salaryBalance),
    noticePayBase: roundedNoticePayParts.base,
    noticePayInsalubrity: roundedNoticePayParts.insalubrity,
    noticePayPericulosidade: roundedNoticePayParts.periculosidade,
    noticePayAdditional: roundedNoticePayParts.additional,
    noticePay: roundMoney(noticePay),
    noticeDeductionBase: roundedNoticeDeductionParts.base,
    noticeDeductionInsalubrity: roundedNoticeDeductionParts.insalubrity,
    noticeDeductionPericulosidade: roundedNoticeDeductionParts.periculosidade,
    noticeDeductionAdditional: roundedNoticeDeductionParts.additional,
    noticeDeduction: roundMoney(noticeDeduction),
    thirteenthCurrentMonths,
    thirteenthNoticeMonths,
    thirteenthMonths,
    thirteenthCurrentBase: roundMoney(thirteenthCurrentParts.base),
    thirteenthCurrentInsalubrity: roundMoney(thirteenthCurrentParts.insalubrity),
    thirteenthCurrentPericulosidade: roundMoney(thirteenthCurrentParts.periculosidade),
    thirteenthCurrentAdditional: roundMoney(thirteenthCurrentParts.additional),
    thirteenthCurrent: roundMoney(thirteenthCurrent),
    thirteenthNoticeProjectionBase: roundMoney(thirteenthNoticeProjectionParts.base),
    thirteenthNoticeProjectionInsalubrity: roundMoney(thirteenthNoticeProjectionParts.insalubrity),
    thirteenthNoticeProjectionPericulosidade: roundMoney(thirteenthNoticeProjectionParts.periculosidade),
    thirteenthNoticeProjectionAdditional: roundMoney(thirteenthNoticeProjectionParts.additional),
    thirteenthNoticeProjection: roundMoney(thirteenthNoticeProjection),
    thirteenthProportional: roundMoney(thirteenthProportional),
    vacationCurrentMonths,
    vacationNoticeMonths,
    vacationProportionalMonths,
    vacationCurrentBase: roundMoney(vacationCurrentBase),
    vacationCurrentThird: roundMoney(vacationCurrentBase / 3),
    vacationNoticeProjectionBase: roundMoney(vacationNoticeProjectionBase),
    vacationNoticeProjectionThird: roundMoney(vacationNoticeProjectionBase / 3),
    vacationProportionalBase: roundMoney(vacationProportionalBase),
    vacationProportionalThird: roundMoney(vacationProportionalThird),
    vacationPeriodsDue,
    vacationDueSimpleBase: roundMoney(vacationDueSimpleBase),
    vacationDueSimpleThird: roundMoney(vacationDueSimpleThird),
    vacationPeriodsDouble,
    vacationDueDoubleBase: roundMoney(vacationDueDoubleBase),
    vacationDueDoubleThird: roundMoney(vacationDueDoubleThird),
    inssSalaryBase: roundMoney(salaryBalance),
    inssSalary: inssSalary.value,
    inssThirteenthBase: roundMoney(thirteenthCurrent),
    inssThirteenth: inssThirteenth.value,
    inssTotal: roundMoney(inssTotal),
    irrfSalaryBase: irrfSalary.base,
    irrfSalary: irrfSalary.value,
    irrfThirteenthBase: irrfThirteenth.base,
    irrfThirteenth: irrfThirteenth.value,
    irrfTotal: roundMoney(irrfTotal),
    taxTableYear: TAX_TABLE_YEAR,
    totalDeductions: roundMoney(totalDeductions),
    totalGross: roundMoney(totalGross),
    directSettlement: roundMoney(directSettlement),
    estimatedNet: roundMoney(estimatedNet),
    fgtsFinePercent,
    fgtsFine: roundMoney(fgtsFine),
    fgtsWithdrawalPercent,
    fgtsWithdrawal: roundMoney(fgtsWithdrawal),
    unemploymentEligible: type === 'sem_justa_causa',
  };
}
