import type { LedgerReportRow, MonthlyLedgerReport } from '../domain/report.ts';
export type { LedgerReportRow, MonthlyLedgerReport } from '../domain/report.ts';
import type { FinancialRatios, FinancialSummary } from '../domain/financial_summary.ts';
import type { MonthlySummary } from '../domain/summary.ts';
import type { Transaction, TransactionType } from '../domain/transaction.ts';
import type { ImageTransactionExtraction } from '../adapters/ai/image_types.ts';
import type { Logger } from '../shared/logger.ts';
import type { PendingImageStore } from './image_pending_store.ts';

export type AppendStatus = 'written' | 'duplicate';
export interface AppendBatchResult {
  status: AppendStatus;
  targetSheets: string[];
}

export interface Ledger {
  appendTransactions(
    signal: AbortSignal,
    updateId: number,
    transactions: Transaction[],
  ): Promise<AppendBatchResult>;
  /** Preferred single-read API used to build reports. */
  monthlyReport: (
    signal: AbortSignal,
    year: number,
    month: number,
  ) => Promise<MonthlyLedgerReport>;
  /** All supported worksheet formats, across every recorded period. */
  allTimeSummary(signal: AbortSignal): Promise<FinancialSummary>;
}

export interface RecordOptions {
  type?: TransactionType;
  originalMessage?: string;
}

export interface AIParser {
  parseTransaction(signal: AbortSignal, message: string): Promise<Transaction>;
  parseImageTransactions(
    signal: AbortSignal,
    caption: string,
    mimeType: string,
    image: Uint8Array,
  ): Promise<ImageTransactionExtraction>;
}

export interface Commentator {
  confirmation(signal: AbortSignal, transaction: Transaction, usedAI: boolean): Promise<string>;
  summaryCommentary(signal: AbortSignal, summary: MonthlySummary): Promise<string>;
  financialAssessment(
    signal: AbortSignal,
    summary: FinancialSummary,
    ratios: FinancialRatios,
  ): Promise<string>;
}

export interface ImageInput {
  caption: string;
  mimeType: string;
  data: Uint8Array;
}
export interface ImagePreparation {
  text: string;
  token: string;
}
export interface ServiceResult {
  text: string;
  parsed?: boolean;
  usedAI?: boolean;
  duplicate?: boolean;
}

export interface ReportResult {
  text: string;
  year: number;
  month: number;
  summary: MonthlySummary;
  rows: LedgerReportRow[];
}

export type ReportResponse = ReportResult | ServiceResult;
export interface ServiceOptions {
  timeZone?: string;
  clock?: () => Date;
  ledger: Ledger;
  ai: AIParser;
  comments?: Commentator;
  pending?: PendingImageStore;
  logger?: Logger;
}
