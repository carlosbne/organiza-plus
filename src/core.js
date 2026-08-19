const MONEY_DECIMALS = 2;

export function roundMoney(value) {
  return Number(Number(value).toFixed(MONEY_DECIMALS));
}

export function parseDuration(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;

  if (/^\d+(?:[.,]\d+)?$/.test(text)) {
    const hours = Number(text.replace(',', '.'));
    if (!Number.isFinite(hours) || hours < 0) throw new TypeError('Duração inválida.');
    return hours;
  }

  const match = /^(\d{1,3}):([0-5]\d)$/.exec(text);
  if (!match) throw new TypeError('Use o formato HH:MM.');
  return Number(match[1]) + Number(match[2]) / 60;
}

function finiteNumber(value, field, { min = 0, positive = false } = {}) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < min || (positive && number <= 0)) {
    throw new TypeError(`${field} inválido.`);
  }
  return number;
}

export function calculateAdditions(input = {}) {
  const salary = finiteNumber(input.salary, 'Salário');
  const divisor = finiteNumber(input.divisor, 'Divisor', { positive: true });
  const overtimePercent = finiteNumber(input.overtimePercent, 'Percentual de hora extra');
  const nightPercent = finiteNumber(input.nightPercent, 'Percentual noturno');
  const workdays = finiteNumber(input.workdays, 'Dias úteis', { positive: true });
  const restDays = finiteNumber(input.restDays, 'Dias de repouso');
  const overtimeHours = parseDuration(input.overtime);
  const reducedNightHours = parseDuration(input.nightHours) * (60 / 52.5);
  const hourlyRate = salary / divisor;
  const overtimeValue = overtimeHours * hourlyRate * (1 + overtimePercent / 100);
  const nightValue = reducedNightHours * hourlyRate * (nightPercent / 100);
  const dsrValue = ((overtimeValue + nightValue) / workdays) * restDays;

  return {
    hourlyRate: roundMoney(hourlyRate),
    overtimeHours: roundMoney(overtimeHours),
    reducedNightHours: roundMoney(reducedNightHours),
    overtimeValue: roundMoney(overtimeValue),
    nightValue: roundMoney(nightValue),
    dsrValue: roundMoney(dsrValue),
    total: roundMoney(overtimeValue + nightValue + dsrValue),
  };
}

const TAX_REGIMES = Object.freeze({
  presumido_real: Object.freeze({ label: 'Lucro Presumido / Real', cpp: 0.2, rat: 0.03, thirdParties: 0.058 }),
  simples_iv: Object.freeze({ label: 'Simples Nacional — Anexo IV', cpp: 0.2, rat: 0.03, thirdParties: 0 }),
  simples_outros: Object.freeze({ label: 'Simples Nacional — Anexos I, II, III e V', cpp: 0, rat: 0, thirdParties: 0 }),
});

export function calculateEmploymentCost(input = {}) {
  const salary = finiteNumber(input.salary, 'Salário', { positive: true });
  const transport = finiteNumber(input.transport, 'Vale-transporte');
  const meal = finiteNumber(input.meal, 'Vale-refeição');
  const benefits = finiteNumber(input.benefits, 'Benefícios');
  const regime = Object.hasOwn(TAX_REGIMES, input.taxRegime) ? TAX_REGIMES[input.taxRegime] : null;
  if (!regime) throw new TypeError('Regime tributário inválido.');

  const vacation = salary / 12;
  const vacationThird = vacation / 3;
  const thirteenthSalary = salary / 12;
  const monthlyFgts = salary * 0.08;
  const provisionsFgts = (vacation + vacationThird + thirteenthSalary) * 0.08;
  const terminationReserve = (monthlyFgts + provisionsFgts) * 0.4;
  const provisions = vacation + vacationThird + thirteenthSalary + monthlyFgts + provisionsFgts + terminationReserve;
  const cpp = salary * regime.cpp;
  const rat = salary * regime.rat;
  const thirdParties = salary * regime.thirdParties;
  const employerCharges = cpp + rat + thirdParties;
  const transportDiscount = Math.min(salary * 0.06, transport);
  const transportCompanyCost = transport - transportDiscount;
  const totalBenefits = transportCompanyCost + meal + benefits;
  const totalMonthlyCost = salary + provisions + employerCharges + totalBenefits;

  return {
    regimeLabel: regime.label,
    salary: roundMoney(salary),
    vacation: roundMoney(vacation),
    vacationThird: roundMoney(vacationThird),
    thirteenthSalary: roundMoney(thirteenthSalary),
    monthlyFgts: roundMoney(monthlyFgts),
    provisionsFgts: roundMoney(provisionsFgts),
    terminationReserve: roundMoney(terminationReserve),
    provisions: roundMoney(provisions),
    cpp: roundMoney(cpp),
    rat: roundMoney(rat),
    thirdParties: roundMoney(thirdParties),
    employerCharges: roundMoney(employerCharges),
    transportCompanyCost: roundMoney(transportCompanyCost),
    totalBenefits: roundMoney(totalBenefits),
    totalMonthlyCost: roundMoney(totalMonthlyCost),
    overheadPercent: roundMoney(((totalMonthlyCost / salary) - 1) * 100),
  };
}

const PRIORITIES = new Set(['alta', 'media', 'baixa']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function validDate(value) {
  const text = cleanText(value, 10);
  if (!text) return '';
  if (!DATE_PATTERN.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError('Data inválida.');
  }
  return text;
}

export function createTask(input = {}, options = {}) {
  const title = cleanText(input.title, 120);
  if (!title) throw new TypeError('Informe o título da tarefa.');
  const priority = cleanText(input.priority || 'media', 10);
  if (!PRIORITIES.has(priority)) throw new TypeError('Prioridade inválida.');

  return Object.freeze({
    id: cleanText(options.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}`, 80),
    title,
    dueDate: validDate(input.dueDate),
    companyCode: cleanText(input.companyCode, 40),
    company: cleanText(input.company, 120),
    priority,
    notes: cleanText(input.notes, 1000),
    done: Boolean(input.done),
    wasOverdue: Boolean(input.wasOverdue),
    createdAt: cleanText(options.now || input.createdAt || new Date().toISOString(), 40),
  });
}

export function isTaskOverdue(task, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(!task.done && task.dueDate && task.dueDate < today);
}

export function getTaskStats(tasks, today) {
  const list = Array.isArray(tasks) ? tasks : [];
  const completed = list.filter((task) => task.done).length;
  const overdue = list.filter((task) => isTaskOverdue(task, today)).length;
  const completedLate = list.filter((task) => task.done && task.wasOverdue).length;
  return {
    total: list.length,
    pending: list.length - completed,
    completed,
    overdue,
    completedLate,
    efficiency: list.length ? Math.round((completed / list.length) * 100) : 0,
  };
}

export function parseStoredTasks(serialized) {
  try {
    const parsed = JSON.parse(serialized || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 2000).flatMap((item) => {
      try {
        return [createTask(item, { id: item?.id, now: item?.createdAt })];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
