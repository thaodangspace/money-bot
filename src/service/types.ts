import type { MonthlySummary } from '../domain/summary.ts';
import type { Transaction } from '../domain/transaction.ts';

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
  monthlySummary(signal: AbortSignal, year: number, month: number): Promise<MonthlySummary>;
}

export interface AIParser {
  parseTransaction(signal: AbortSignal, message: string): Promise<Transaction>;
  parseImageTransaction(
    signal: AbortSignal,
    caption: string,
    mimeType: string,
    image: Uint8Array,
  ): Promise<Transaction>;
}

export interface Commentator {
  confirmation(signal: AbortSignal, transaction: Transaction, usedAI: boolean): Promise<string>;
  summaryCommentary(signal: AbortSignal, summary: MonthlySummary): Promise<string>;
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

export interface ServiceOptions {
  timeZone?: string;
  clock?: () => Date;
  ledger: Ledger;
  ai: AIParser;
  comments?: Commentator;
}
