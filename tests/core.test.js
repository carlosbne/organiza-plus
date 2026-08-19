import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAdditions,
  calculateEmploymentCost,
  createTask,
  getTaskStats,
  isTaskOverdue,
  parseStoredTasks,
  parseDuration,
} from '../src/core.js';

test('parseDuration converte HH:MM em horas decimais', () => {
  assert.equal(parseDuration('01:30'), 1.5);
});

test('parseDuration rejeita minutos fora do intervalo', () => {
  assert.throws(() => parseDuration('01:75'), /formato/i);
});

test('calculateAdditions calcula hora extra, adicional noturno e DSR', () => {
  const result = calculateAdditions({
    salary: 2200,
    divisor: 220,
    overtimePercent: 50,
    overtime: '02:00',
    nightPercent: 20,
    nightHours: '07:00',
    workdays: 25,
    restDays: 5,
  });

  assert.deepEqual(result, {
    hourlyRate: 10,
    overtimeHours: 2,
    reducedNightHours: 8,
    overtimeValue: 30,
    nightValue: 16,
    dsrValue: 9.2,
    total: 55.2,
  });
});

test('calculateAdditions rejeita divisor zero', () => {
  assert.throws(() => calculateAdditions({ salary: 2200, divisor: 0 }), /divisor/i);
});

test('calculateEmploymentCost aplica encargos do Lucro Presumido ou Real', () => {
  const result = calculateEmploymentCost({
    salary: 3000,
    taxRegime: 'presumido_real',
    transport: 300,
    meal: 500,
    benefits: 200,
  });

  assert.equal(result.employerCharges, 864);
  assert.equal(result.transportCompanyCost, 120);
  assert.equal(result.totalBenefits, 820);
  assert.equal(result.totalMonthlyCost, 5668.67);
});

test('calculateEmploymentCost não aceita regime tributário desconhecido', () => {
  assert.throws(
    () => calculateEmploymentCost({ salary: 3000, taxRegime: '__proto__' }),
    /regime tributário/i,
  );
});

test('createTask valida, normaliza e limita os dados persistidos', () => {
  const task = createTask({
    title: '  Fechar folha  ',
    dueDate: '2026-08-20',
    companyCode: ' 001 ',
    company: '<img src=x onerror=alert(1)>',
    priority: 'alta',
    notes: 'Conferir encargos',
  }, { id: 'task-1', now: '2026-08-17T12:00:00.000Z' });

  assert.equal(task.title, 'Fechar folha');
  assert.equal(task.companyCode, '001');
  assert.equal(task.company, '<img src=x onerror=alert(1)>');
  assert.equal(task.id, 'task-1');
  assert.equal(task.done, false);
});

test('createTask rejeita prioridade não permitida', () => {
  assert.throws(() => createTask({ title: 'Teste', priority: '__proto__' }), /prioridade/i);
});

test('isTaskOverdue compara datas locais sem considerar tarefas concluídas', () => {
  assert.equal(isTaskOverdue({ dueDate: '2026-08-16', done: false }, '2026-08-17'), true);
  assert.equal(isTaskOverdue({ dueDate: '2026-08-16', done: true }, '2026-08-17'), false);
});

test('getTaskStats calcula totais, atrasos e eficiência', () => {
  const tasks = [
    { dueDate: '2026-08-16', done: false, wasOverdue: true },
    { dueDate: '2026-08-16', done: true, wasOverdue: true },
    { dueDate: '2026-08-20', done: true, wasOverdue: false },
  ];
  assert.deepEqual(getTaskStats(tasks, '2026-08-17'), {
    total: 3,
    pending: 1,
    completed: 2,
    overdue: 1,
    completedLate: 1,
    efficiency: 67,
  });
});

test('parseStoredTasks descarta armazenamento inválido sem executar propriedades extras', () => {
  assert.deepEqual(parseStoredTasks('{"polluted":true}'), []);
  assert.deepEqual(parseStoredTasks('not-json'), []);
});
