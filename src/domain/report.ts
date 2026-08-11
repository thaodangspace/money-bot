import type { MonthlySummary } from './summary.ts';
import type { TransactionType } from './transaction.ts';

export interface LedgerReportRow {
  date: string;
  type: TransactionType;
  content: string;
  amount: number;
}

export interface MonthlyLedgerReport {
  summary: MonthlySummary;
  rows: LedgerReportRow[];
}
