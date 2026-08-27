import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTerminationSettlement,
  completeServiceYears,
  countThirteenthMonths,
  countVacationProportionalMonths,
  noticeDaysForService,
} from '../src/termination.js';

const base = {
  terminationType: 'sem_justa_causa',
  noticeMode: 'indenizado',
  admissionDate: '2023-06-01',
  terminationDate: '2026-08-26',
  salary: 2000,
  additionalMonthlyAverage: 0,
  vacationPeriodsDue: 0,
  vacationPeriodsDouble: 0,
  fgtsBalance: 10000,
};

test('calcula o aviso-prévio proporcional de 30 a 90 dias', () => {
  assert.equal(noticeDaysForService(0), 30);
  assert.equal(noticeDaysForService(1), 33);
  assert.equal(noticeDaysForService(20), 90);
  assert.equal(noticeDaysForService(25), 90);
});

test('conta anos completos e avos com a fração legal de 15 dias', () => {
  assert.equal(completeServiceYears('2023-06-01', '2026-05-31'), 2);
  assert.equal(completeServiceYears('2023-06-01', '2026-06-01'), 3);
  assert.equal(countThirteenthMonths('2025-01-20', '2025-03-14', 2025), 1);
  assert.equal(countThirteenthMonths('2025-01-20', '2025-03-15', 2025), 2);
  assert.equal(countVacationProportionalMonths('2025-01-20', '2025-03-14'), 1);
  assert.equal(countVacationProportionalMonths('2025-01-20', '2025-03-15'), 2);
});

test('calcula dispensa sem justa causa com aviso indenizado e FGTS integral', () => {
  const result = calculateTerminationSettlement(base);

  assert.equal(result.serviceYears, 3);
  assert.equal(result.noticeDays, 39);
  assert.equal(result.projectedNoticeDays, 39);
  assert.equal(result.projectedTerminationDate, '2026-10-04');
  assert.equal(result.salaryBalance, 1733.33);
  assert.equal(result.noticePay, 2600);
  assert.equal(result.thirteenthMonths, 9);
  assert.equal(result.thirteenthProportional, 1500);
  assert.equal(result.vacationProportionalMonths, 4);
  assert.equal(result.vacationProportionalBase, 666.67);
  assert.equal(result.vacationProportionalThird, 222.22);
  assert.equal(result.totalGross, 6722.22);
  assert.equal(result.directSettlement, 6722.22);
  assert.equal(result.fgtsFinePercent, 40);
  assert.equal(result.fgtsFine, 4000);
  assert.equal(result.fgtsWithdrawalPercent, 100);
  assert.equal(result.fgtsWithdrawal, 10000);
  assert.equal(result.unemploymentEligible, true);
});

test('calcula dispensa sem justa causa com aviso trabalhado sem duplicar o aviso', () => {
  const result = calculateTerminationSettlement({
    ...base,
    noticeMode: 'trabalhado',
    admissionDate: '2025-01-20',
    terminationDate: '2025-03-15',
    salary: 3000,
    fgtsBalance: 0,
  });

  assert.equal(result.noticeDays, 30);
  assert.equal(result.noticePay, 0);
  assert.equal(result.projectedNoticeDays, 0);
  assert.equal(result.thirteenthMonths, 2);
  assert.equal(result.vacationProportionalMonths, 2);
  assert.equal(result.salaryBalance, 1500);
  assert.equal(result.totalGross, 2666.67);
});

test('calcula acordo do art. 484-A com metade do aviso e multa de 20%', () => {
  const result = calculateTerminationSettlement({
    ...base,
    terminationType: 'acordo_484a',
  });

  assert.equal(result.noticeDays, 39);
  assert.equal(result.noticePay, 1300);
  assert.equal(result.projectedNoticeDays, 20);
  assert.equal(result.projectedTerminationDate, '2026-09-15');
  assert.equal(result.thirteenthMonths, 9);
  assert.equal(result.vacationProportionalMonths, 4);
  assert.equal(result.totalGross, 5422.22);
  assert.equal(result.fgtsFinePercent, 20);
  assert.equal(result.fgtsFine, 2000);
  assert.equal(result.fgtsWithdrawalPercent, 80);
  assert.equal(result.fgtsWithdrawal, 8000);
  assert.equal(result.unemploymentEligible, false);
});

test('calcula pedido de demissão com desconto limitado a 30 dias', () => {
  const result = calculateTerminationSettlement({
    ...base,
    terminationType: 'pedido_demissao',
    noticeMode: 'descontado',
    admissionDate: '2025-01-01',
    terminationDate: '2025-06-10',
    salary: 3000,
    fgtsBalance: 5000,
  });

  assert.equal(result.noticeDays, 30);
  assert.equal(result.noticePay, 0);
  assert.equal(result.noticeDeduction, 3000);
  assert.equal(result.thirteenthMonths, 5);
  assert.equal(result.vacationProportionalMonths, 5);
  assert.equal(result.totalGross, 3916.67);
  assert.equal(result.directSettlement, 916.67);
  assert.equal(result.fgtsFine, 0);
  assert.equal(result.fgtsWithdrawal, 0);
  assert.equal(result.unemploymentEligible, false);
});

test('calcula justa causa sem aviso, 13º proporcional ou férias proporcionais', () => {
  const result = calculateTerminationSettlement({
    ...base,
    terminationType: 'com_justa_causa',
    noticeMode: 'nao_aplicavel',
    terminationDate: '2025-08-20',
    salary: 3000,
    vacationPeriodsDue: 1,
    vacationPeriodsDouble: 1,
    fgtsBalance: 5000,
  });

  assert.equal(result.noticeDays, 0);
  assert.equal(result.noticePay, 0);
  assert.equal(result.thirteenthMonths, 0);
  assert.equal(result.vacationProportionalMonths, 0);
  assert.equal(result.vacationDueSimpleBase, 3000);
  assert.equal(result.vacationDueSimpleThird, 1000);
  assert.equal(result.vacationDueDoubleBase, 6000);
  assert.equal(result.vacationDueDoubleThird, 2000);
  assert.equal(result.salaryBalance, 2000);
  assert.equal(result.totalGross, 14000);
  assert.equal(result.fgtsFine, 0);
  assert.equal(result.unemploymentEligible, false);
});

test('integra a média mensal de adicionais à remuneração das verbas', () => {
  const result = calculateTerminationSettlement({
    ...base,
    noticeMode: 'trabalhado',
    admissionDate: '2026-01-01',
    terminationDate: '2026-02-15',
    salary: 3000,
    additionalMonthlyAverage: 500,
    fgtsBalance: 0,
  });

  assert.equal(result.remuneration, 3500);
  assert.equal(result.salaryBalance, 1750);
  assert.equal(result.thirteenthMonths, 2);
  assert.equal(result.thirteenthProportional, 583.33);
  assert.equal(result.vacationProportionalMonths, 2);
  assert.equal(result.vacationProportionalBase, 583.33);
  assert.equal(result.vacationProportionalThird, 194.44);
});

test('rejeita datas, valores e combinações de aviso inválidos', () => {
  assert.throws(() => calculateTerminationSettlement({ ...base, admissionDate: '2026-02-30' }), /data de admissão/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, terminationDate: '2023-05-31' }), /antes da admissão/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, salary: 0 }), /salário-base/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, noticeMode: 'descontado' }), /incompatível/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, vacationPeriodsDue: 1.5 }), /férias vencidas/i);
});
