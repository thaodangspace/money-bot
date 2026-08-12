import type { LedgerReportRow } from './report.ts';
import {
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
  TRANSACTION_INVEST,
  TRANSACTION_SAVING,
} from './transaction.ts';

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  totalInvest: number;
  totalSaving: number;
  cashAvailable: number;
  entryCount: number;
  firstTransactionDate?: string;
  lastTransactionDate?: string;
}

export interface FinancialRatios {
  expenseToIncome?: number;
  savingToIncome?: number;
  investToIncome?: number;
}

export function summarizeFinancialRows(rows: LedgerReportRow[]): FinancialSummary {
  let totalIncome = 0;
  let totalExpenses = 0;
  let totalInvest = 0;
  let totalSaving = 0;
  let firstTransactionDate: string | undefined;
  let lastTransactionDate: string | undefined;

  for (const row of rows) {
    if (row.type === TRANSACTION_INCOME) totalIncome = safeAdd(totalIncome, row.amount);
    else if (row.type === TRANSACTION_EXPENSE) totalExpenses = safeAdd(totalExpenses, row.amount);
    else if (row.type === TRANSACTION_INVEST) totalInvest = safeAdd(totalInvest, row.amount);
    else if (row.type === TRANSACTION_SAVING) totalSaving = safeAdd(totalSaving, row.amount);

    if (
      firstTransactionDate === undefined ||
      dateSortValue(row.date) < dateSortValue(firstTransactionDate)
    ) firstTransactionDate = row.date;
    if (
      lastTransactionDate === undefined ||
      dateSortValue(row.date) > dateSortValue(lastTransactionDate)
    ) lastTransactionDate = row.date;
  }

  const cashAvailable = safeSubtract(
    safeSubtract(safeSubtract(totalIncome, totalExpenses), totalInvest),
    totalSaving,
  );
  return {
    totalIncome,
    totalExpenses,
    totalInvest,
    totalSaving,
    cashAvailable,
    entryCount: rows.length,
    ...(firstTransactionDate ? { firstTransactionDate } : {}),
    ...(lastTransactionDate ? { lastTransactionDate } : {}),
  };
}

export function financialRatios(summary: FinancialSummary): FinancialRatios {
  if (summary.totalIncome === 0) return {};
  return {
    expenseToIncome: summary.totalExpenses / summary.totalIncome,
    savingToIncome: summary.totalSaving / summary.totalIncome,
    investToIncome: summary.totalInvest / summary.totalIncome,
  };
}

function dateSortValue(value: string): number {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  return match ? Number(`${match[3]}${match[2]}${match[1]}`) : Number.MAX_SAFE_INTEGER;
}

function safeAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
    throw new Error('financial summary exceeds safe integer range');
  }
  return left + right;
}

function safeSubtract(left: number, right: number): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) {
    throw new Error('financial summary exceeds safe integer range');
  }
  return result;
}
