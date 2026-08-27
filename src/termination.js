const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

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

function noticeConfiguration(type, mode, remuneration, statutoryNoticeDays) {
  const validModes = VALID_NOTICE_MODES[type];
  if (!validModes?.includes(mode)) throw new TypeError('Modalidade de aviso-prévio incompatível com o desligamento.');

  if (type === 'sem_justa_causa' && mode === 'indenizado') {
    return { noticePay: remuneration / 30 * statutoryNoticeDays, noticeDeduction: 0, projectionDays: statutoryNoticeDays };
  }
  if (type === 'acordo_484a' && mode === 'indenizado') {
    const halfNotice = statutoryNoticeDays / 2;
    return { noticePay: remuneration / 30 * halfNotice, noticeDeduction: 0, projectionDays: Math.round(halfNotice) };
  }
  if (type === 'pedido_demissao' && mode === 'descontado') {
    return { noticePay: 0, noticeDeduction: remuneration / 30 * Math.min(30, statutoryNoticeDays), projectionDays: 0 };
  }
  return { noticePay: 0, noticeDeduction: 0, projectionDays: 0 };
}

export function calculateTerminationSettlement(input = {}) {
  const type = String(input.terminationType || '').trim();
  if (!Object.hasOwn(TERMINATION_TYPES, type)) throw new TypeError('Tipo de desligamento inválido.');

  const mode = String(input.noticeMode || '').trim();
  const admissionDate = parseDateKey(input.admissionDate, 'Data de admissão');
  const terminationDate = parseDateKey(input.terminationDate, 'Data do desligamento');
  if (compareDates(terminationDate, admissionDate) < 0) throw new TypeError('O desligamento não pode ocorrer antes da admissão.');

  const salary = positiveNumber(input.salary, 'Salário-base');
  const additionalMonthlyAverage = nonNegativeNumber(input.additionalMonthlyAverage, 'Média de adicionais');
  const remuneration = salary + additionalMonthlyAverage;
  const vacationPeriodsDue = nonNegativeInteger(input.vacationPeriodsDue, 'Férias vencidas');
  const vacationPeriodsDouble = nonNegativeInteger(input.vacationPeriodsDouble, 'Férias em dobro');
  const fgtsBalance = nonNegativeNumber(input.fgtsBalance, 'Saldo do FGTS');

  const serviceYears = completeServiceYears(admissionDate, terminationDate);
  const statutoryNoticeDays = type === 'pedido_demissao'
    ? 30
    : type === 'com_justa_causa'
      ? 0
      : noticeDaysForService(serviceYears);
  const notice = noticeConfiguration(type, mode, remuneration, statutoryNoticeDays);
  const projectedTerminationDate = addCalendarDays(terminationDate, notice.projectionDays);

  const salaryBalance = remuneration / 30 * terminationDate.getUTCDate();
  const thirteenthMonths = type === 'com_justa_causa'
    ? 0
    : countThirteenthMonths(admissionDate, projectedTerminationDate, terminationDate.getUTCFullYear());
  const thirteenthProportional = remuneration / 12 * thirteenthMonths;

  const vacationProportionalMonths = type === 'com_justa_causa'
    ? 0
    : countVacationProportionalMonths(admissionDate, projectedTerminationDate);
  const vacationProportionalBase = remuneration / 12 * vacationProportionalMonths;
  const vacationProportionalThird = vacationProportionalBase / 3;
  const vacationDueSimpleBase = remuneration * vacationPeriodsDue;
  const vacationDueSimpleThird = vacationDueSimpleBase / 3;
  const vacationDueDoubleBase = remuneration * 2 * vacationPeriodsDouble;
  const vacationDueDoubleThird = vacationDueDoubleBase / 3;

  const totalGross = salaryBalance
    + notice.noticePay
    + thirteenthProportional
    + vacationProportionalBase
    + vacationProportionalThird
    + vacationDueSimpleBase
    + vacationDueSimpleThird
    + vacationDueDoubleBase
    + vacationDueDoubleThird;
  const directSettlement = totalGross - notice.noticeDeduction;
  const fgtsFinePercent = type === 'sem_justa_causa' ? 40 : type === 'acordo_484a' ? 20 : 0;
  const fgtsWithdrawalPercent = type === 'sem_justa_causa' ? 100 : type === 'acordo_484a' ? 80 : 0;
  const fgtsFine = fgtsBalance * (fgtsFinePercent / 100);
  const fgtsWithdrawal = fgtsBalance * (fgtsWithdrawalPercent / 100);

  return {
    terminationType: type,
    terminationTypeLabel: TERMINATION_TYPES[type],
    noticeMode: mode,
    noticeModeLabel: NOTICE_MODES[mode],
    admissionDate: dateKey(admissionDate),
    terminationDate: dateKey(terminationDate),
    projectedTerminationDate: dateKey(projectedTerminationDate),
    remuneration: roundMoney(remuneration),
    serviceYears,
    noticeDays: statutoryNoticeDays,
    projectedNoticeDays: notice.projectionDays,
    salaryBalance: roundMoney(salaryBalance),
    noticePay: roundMoney(notice.noticePay),
    noticeDeduction: roundMoney(notice.noticeDeduction),
    thirteenthMonths,
    thirteenthProportional: roundMoney(thirteenthProportional),
    vacationProportionalMonths,
    vacationProportionalBase: roundMoney(vacationProportionalBase),
    vacationProportionalThird: roundMoney(vacationProportionalThird),
    vacationPeriodsDue,
    vacationDueSimpleBase: roundMoney(vacationDueSimpleBase),
    vacationDueSimpleThird: roundMoney(vacationDueSimpleThird),
    vacationPeriodsDouble,
    vacationDueDoubleBase: roundMoney(vacationDueDoubleBase),
    vacationDueDoubleThird: roundMoney(vacationDueDoubleThird),
    totalGross: roundMoney(totalGross),
    directSettlement: roundMoney(directSettlement),
    fgtsFinePercent,
    fgtsFine: roundMoney(fgtsFine),
    fgtsWithdrawalPercent,
    fgtsWithdrawal: roundMoney(fgtsWithdrawal),
    unemploymentEligible: type === 'sem_justa_causa',
  };
}
