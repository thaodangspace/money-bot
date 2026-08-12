import type { FinancialSummary } from '../domain/financial_summary.ts';
import { newMonthlySummary } from '../domain/summary.ts';
import { type Transaction, TRANSACTION_INCOME } from '../domain/transaction.ts';
import {
  boundText,
  duplicateText,
  formatDong,
  formatFinancialSummary,
  formatSummary,
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

Deno.test('financial summary formatting is deterministic and explicit about derived cash', () => {
  const summary: FinancialSummary = {
    totalIncome: 250_000_000,
    totalExpenses: 120_000_000,
    totalInvest: 40_000_000,
    totalSaving: 50_000_000,
    cashAvailable: 40_000_000,
    entryCount: 185,
    firstTransactionDate: '01/01/2026',
    lastTransactionDate: '12/08/2026',
  };
  const text = formatFinancialSummary(summary);
  if (!text.includes('\n') || text.includes('\\n')) throw new Error(`invalid line breaks: ${text}`);
  for (
    const expected of [
      '250.000.000 ₫',
      '120.000.000 ₫',
      '50.000.000 ₫',
      '40.000.000 ₫',
      '01/01/2026 → 12/08/2026',
      'Tiền mặt khả dụng',
      'không phải số dư ngân hàng',
      '48.0%',
    ]
  ) if (!text.includes(expected)) throw new Error(`${expected}: ${text}`);
});

Deno.test('empty financial summary has no data state', () => {
  const text = formatFinancialSummary({
    totalIncome: 0,
    totalExpenses: 0,
    totalInvest: 0,
    totalSaving: 0,
    cashAvailable: 0,
    entryCount: 0,
  });
  if (!text.includes('Chưa có giao dịch')) throw new Error(text);
});

Deno.test('summary formatting includes investment and saving totals', () => {
  const summary = newMonthlySummary(2026, 7, 100, 200, 4, 50, 25);
  const text = formatSummary(summary);
  if (
    !text.includes('Tổng đầu tư: 50 ₫') || !text.includes('Tổng tiết kiệm: 25 ₫') ||
    !text.includes('Còn lại: 25 ₫')
  ) throw new Error(text);
});

function equal<T>(actual: T, expected: T): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}
