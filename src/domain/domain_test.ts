import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
  TRANSACTION_INVEST,
  TRANSACTION_SAVING,
  transactionContent,
  validateTransaction,
} from './transaction.ts';
import { financialRatios, summarizeFinancialRows } from './financial_summary.ts';
import { newMonthlySummary } from './summary.ts';

Deno.test('transaction content uses original message with category tag', () => {
  const transaction: Transaction = {
    category: ' food ',
    note: ' pizza ',
    originalMessage: ' ăn tối  150k ',
    amount: 150_000,
    type: TRANSACTION_EXPENSE,
  };
  equal(transactionContent(transaction), '(food) ăn tối 150k');
});

Deno.test('transaction content falls back to category and note', () => {
  const transaction: Transaction = {
    category: ' Ăn tối ',
    note: ' pizza ',
    amount: 150_000,
    type: TRANSACTION_EXPENSE,
  };
  equal(transactionContent(transaction), 'Ăn tối pizza');
});

Deno.test('invest and saving are valid transaction types', () => {
  for (const type of [TRANSACTION_INVEST, TRANSACTION_SAVING]) {
    validateTransaction({ type, category: 'asset', amount: 1 });
  }
});

Deno.test('transaction validation reports all invalid fields', () => {
  const transaction: Transaction = { category: ' ', amount: 0, type: 'bad' as never };
  let message = '';
  try {
    validateTransaction(transaction);
  } catch (error) {
    message = String(error);
  }
  for (const expected of ['transaction type', 'category', 'amount']) {
    if (!message.includes(expected)) throw new Error(`missing ${expected}: ${message}`);
  }
});

Deno.test('financial summary aggregates buckets, cash, and date range', () => {
  const summary = summarizeFinancialRows([
    { date: '18/07/2026', type: TRANSACTION_INCOME, content: '', amount: 250_000_000 },
    { date: '01/01/2026', type: TRANSACTION_EXPENSE, content: '', amount: 120_000_000 },
    { date: '12/08/2026', type: TRANSACTION_SAVING, content: '', amount: 50_000_000 },
    { date: '05/08/2026', type: TRANSACTION_INVEST, content: '', amount: 40_000_000 },
  ]);
  equal(summary.totalIncome, 250_000_000);
  equal(summary.totalExpenses, 120_000_000);
  equal(summary.totalSaving, 50_000_000);
  equal(summary.totalInvest, 40_000_000);
  equal(summary.cashAvailable, 40_000_000);
  equal(summary.firstTransactionDate, '01/01/2026');
  equal(summary.lastTransactionDate, '12/08/2026');
  equal(financialRatios(summary).expenseToIncome, 0.48);
});

Deno.test('financial summary preserves negative cash and omits zero-income ratios', () => {
  const summary = summarizeFinancialRows([
    { date: '18/07/2026', type: TRANSACTION_EXPENSE, content: '', amount: 200 },
    { date: '19/07/2026', type: TRANSACTION_INVEST, content: '', amount: 100 },
  ]);
  equal(summary.cashAvailable, -300);
  if (Object.keys(financialRatios(summary)).length !== 0) throw new Error('ratios were present');
});

Deno.test('financial ratios do not overflow on valid saving and investment totals', () => {
  const summary = summarizeFinancialRows([
    { date: '01/01/2026', type: TRANSACTION_INCOME, content: '', amount: Number.MAX_SAFE_INTEGER },
    { date: '02/01/2026', type: TRANSACTION_INVEST, content: '', amount: Number.MAX_SAFE_INTEGER },
    { date: '03/01/2026', type: TRANSACTION_SAVING, content: '', amount: Number.MAX_SAFE_INTEGER },
  ]);
  equal(summary.cashAvailable, -Number.MAX_SAFE_INTEGER);
  const ratios = financialRatios(summary);
  equal(ratios.investToIncome, 1);
  equal(ratios.savingToIncome, 1);
});

Deno.test('financial summary rejects unsafe aggregate overflow', () => {
  let failed = false;
  try {
    summarizeFinancialRows([
      {
        date: '01/01/2026',
        type: TRANSACTION_INCOME,
        content: '',
        amount: Number.MAX_SAFE_INTEGER,
      },
      { date: '02/01/2026', type: TRANSACTION_INCOME, content: '', amount: 1 },
    ]);
  } catch {
    failed = true;
  }
  if (!failed) throw new Error('overflow was accepted');
});

Deno.test('monthly summary computes balance', () => {
  const summary = newMonthlySummary(2026, 7, 150_000, 200_000, 2);
  equal(summary.balance, 50_000);
  equal(summary.entryCount, 2);
  equal(summary.year, 2026);
  equal(summary.month, 7);
  equal(summary.totalIncome, 200_000);
});

function equal<T>(actual: T, expected: T): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}

void TRANSACTION_INCOME;
void TRANSACTION_INVEST;
void TRANSACTION_SAVING;
