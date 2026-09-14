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

test('calcula dispensa do aviso no pedido de demissão sem gerar verba ou desconto', () => {
  const result = calculateTerminationSettlement({
    ...base,
    terminationType: 'pedido_demissao',
    noticeMode: 'dispensado',
    admissionDate: '2026-01-01',
    terminationDate: '2026-02-15',
    salary: 3000,
    fgtsBalance: 0,
  });

  assert.equal(result.noticeDays, 30);
  assert.equal(result.noticePay, 0);
  assert.equal(result.noticeDeduction, 0);
  assert.equal(result.projectedNoticeDays, 0);
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
  assert.equal(result.vacationCurrentThird, 0);
  assert.equal(result.vacationNoticeProjectionThird, 0);
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
  assert.equal(result.salaryBalanceAdditional, 250);
  assert.equal(result.thirteenthCurrentAdditional, 83.33);
  assert.equal(result.vacationCurrentThird, 194.44);
});

test('aplica desconto de faltas sobre a remuneração e outros descontos fixos', () => {
  const result = calculateTerminationSettlement({
    ...base,
    noticeMode: 'trabalhado',
    admissionDate: '2026-01-01',
    terminationDate: '2026-02-15',
    salary: 3000,
    additionalMonthlyAverage: 500,
    absenceDays: 2,
    otherDeductions: 150,
    fgtsBalance: 0,
  });

  assert.equal(result.remuneration, 3500);
  assert.equal(result.absenceDays, 2);
  assert.equal(result.absenceDeduction, 233.33);
  assert.equal(result.otherDeductions, 150);
  assert.equal(result.directSettlement, 2727.78);
  assert.equal(result.totalDeductions, 233.33 + 150 + result.inssTotal + result.irrfTotal);
});

test('rejeita dias de falta e outros descontos negativos', () => {
  assert.throws(() => calculateTerminationSettlement({ ...base, absenceDays: -1 }), /faltas/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, otherDeductions: -1 }), /outros descontos/i);
});

test('rejeita datas, valores e combinações de aviso inválidos', () => {
  assert.throws(() => calculateTerminationSettlement({ ...base, admissionDate: '2026-02-30' }), /data de admissão/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, terminationDate: '2023-05-31' }), /antes da admissão/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, salary: 0 }), /salário-base/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, noticeMode: 'descontado' }), /incompatível/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, vacationPeriodsDue: 1.5 }), /férias vencidas/i);
});

test('aplica todos os graus de insalubridade sobre o salário mínimo informado', () => {
  for (const [percent, value] of [[10, 162.10], [20, 324.20], [40, 648.40]]) {
    const result = calculateTerminationSettlement({
      ...base,
      noticeMode: 'trabalhado',
      admissionDate: '2026-01-01',
      terminationDate: '2026-01-31',
      minimumWage: 1621,
      insalubrityPercent: percent,
      hazardousPercent: 0,
      fgtsBalance: 0,
    });

    assert.equal(result.insalubrityValue, value);
    assert.equal(result.remuneration, 2000 + value);
  }
});

test('discrimina insalubridade sobre saldo, aviso, 13º e férias', () => {
  const result = calculateTerminationSettlement({
    ...base,
    employeeName: 'Artur Fernandes',
    minimumWage: 1621,
    insalubrityPercent: 20,
    hazardousPercent: 0,
  });

  assert.equal(result.employeeName, 'Artur Fernandes');
  assert.equal(result.insalubrityValue, 324.20);
  assert.equal(result.remuneration, 2324.20);
  assert.equal(result.salaryBalanceBase, 1733.33);
  assert.equal(result.salaryBalanceInsalubrity, 280.97);
  assert.equal(result.noticePayBase, 2600);
  assert.equal(result.noticePayInsalubrity, 421.46);
  assert.equal(result.thirteenthCurrentMonths, 8);
  assert.equal(result.thirteenthNoticeMonths, 1);
  assert.equal(result.thirteenthCurrentInsalubrity, 216.13);
  assert.equal(result.thirteenthNoticeProjectionInsalubrity, 27.02);
  assert.equal(result.vacationCurrentMonths, 3);
  assert.equal(result.vacationNoticeMonths, 1);
  assert.equal(result.vacationCurrentBase, 581.05);
  assert.equal(result.vacationNoticeProjectionBase, 193.68);
  assert.equal(result.inssSalaryBase, 2014.31);
  assert.equal(result.inssThirteenthBase, 1549.47);
  assert.equal(result.taxTableYear, 2026);
  assert.equal(result.totalGross, 7811.89);
  assert.equal(result.estimatedNet, 7538.71);
});

test('calcula periculosidade sobre o salário-base e não acumula com insalubridade', () => {
  const result = calculateTerminationSettlement({
    ...base,
    noticeMode: 'trabalhado',
    admissionDate: '2026-01-01',
    terminationDate: '2026-02-15',
    salary: 3000,
    insalubrityPercent: 0,
    hazardousPercent: 30,
    fgtsBalance: 0,
  });

  assert.equal(result.hazardousValue, 900);
  assert.equal(result.remuneration, 3900);
  assert.equal(result.salaryBalanceBase, 1500);
  assert.equal(result.salaryBalancePericulosidade, 450);
  assert.equal(result.thirteenthCurrentPericulosidade, 150);
  assert.equal(result.vacationCurrentBase, 650);
  assert.equal(result.noticePay, 0);
  assert.throws(() => calculateTerminationSettlement({
    ...base,
    insalubrityPercent: 20,
    hazardousPercent: 30,
  }), /não são acumulados/i);
});

test('separa o avo adicional do 13º quando a projeção do aviso atravessa o ano', () => {
  const result = calculateTerminationSettlement({
    ...base,
    admissionDate: '2025-01-01',
    terminationDate: '2026-12-20',
    salary: 3000,
    insalubrityPercent: 0,
    hazardousPercent: 0,
    fgtsBalance: 0,
  });

  assert.equal(result.projectedTerminationDate, '2027-01-22');
  assert.equal(result.thirteenthCurrentMonths, 12);
  assert.equal(result.thirteenthNoticeMonths, 1);
  assert.equal(result.thirteenthMonths, 13);
  assert.equal(result.thirteenthCurrent, 3000);
  assert.equal(result.thirteenthNoticeProjection, 250);
});

test('valida salário mínimo, dependentes e protege o nome exibido', () => {
  const result = calculateTerminationSettlement({
    ...base,
    employeeName: '  Ana\u0000 Maria  ',
    minimumWage: 1700,
    insalubrityPercent: 10,
    hazardousPercent: 0,
    dependents: 2,
  });

  assert.equal(result.employeeName, 'Ana Maria');
  assert.equal(result.minimumWage, 1700);
  assert.equal(result.insalubrityValue, 170);
  assert.equal(result.dependents, 2);
  assert.throws(() => calculateTerminationSettlement({ ...base, minimumWage: 0 }), /salário mínimo/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, insalubrityPercent: 15 }), /percentual de insalubridade/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, hazardousPercent: 20 }), /percentual de periculosidade/i);
  assert.throws(() => calculateTerminationSettlement({ ...base, dependents: 1.5 }), /dependentes/i);
});
