import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
  transactionContent,
  validateTransaction,
} from './transaction.ts';
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
