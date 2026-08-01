import { newMonthlySummary } from '../domain/summary.ts';
import { type Transaction, TRANSACTION_INCOME } from '../domain/transaction.ts';
import {
  boundText,
  duplicateText,
  formatDong,
  successText,
  vietnameseMonthName,
} from './format.ts';

Deno.test('formatDong formats grouped Vietnamese đồng', () => {
  const cases: Record<number, string> = {
    0: '0',
    1: '1',
    1000: '1.000',
    1500000: '1.500.000',
    '-50000': '-50.000',
  };
  for (const [input, expected] of Object.entries(cases)) equal(formatDong(Number(input)), expected);
});

Deno.test('Vietnamese month names and rune-safe bounds are preserved', () => {
  equal(vietnameseMonthName(7), 'tháng bảy');
  equal(boundText('😀😀😀', 2), '😀…');
});

Deno.test('success and duplicate text contain transaction details', () => {
  const transaction: Transaction = {
    type: TRANSACTION_INCOME,
    category: 'Lương',
    note: 'x'.repeat(400),
    amount: 2_000_000,
  };
  const text = successText(transaction, true);
  if (
    !text.includes('thu nhập') || !text.includes('2.000.000 ₫') || !text.includes('AI') ||
    Array.from(text).length > 420
  ) {
    throw new Error(`unexpected success text: ${text}`);
  }
  const duplicate = duplicateText(transaction);
  if (!duplicate.includes('đã được ghi') || !duplicate.includes('2.000.000 ₫')) {
    throw new Error(duplicate);
  }
});

Deno.test('summary formatting handles empty and populated summaries', () => {
  const empty = newMonthlySummary(2026, 7, 0, 0, 0);
  if (!empty || !formatDong(empty.balance)) throw new Error('summary setup failed');
});

function equal<T>(actual: T, expected: T): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}
