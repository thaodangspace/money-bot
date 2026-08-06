import type { ConversationContext, ConversationIntent } from '../domain/conversation.ts';
import type { MonthlySummary } from '../domain/summary.ts';
import type { Transaction } from '../domain/transaction.ts';
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
  monthlySummary(signal: AbortSignal, year: number, month: number): Promise<MonthlySummary>;
}

export interface ConversationRouter {
  route(
    signal: AbortSignal,
    input: {
      message: string;
      now: string;
      timeZone: string;
      context?: ConversationContext;
    },
  ): Promise<ConversationIntent>;
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
  context?: ConversationContext;
  parsed?: boolean;
  usedAI?: boolean;
  duplicate?: boolean;
}
export interface ServiceOptions {
  timeZone?: string;
  clock?: () => Date;
  ledger: Ledger;
  ai: AIParser;
  router?: ConversationRouter;
  comments?: Commentator;
  pending?: PendingImageStore;
  logger?: Logger;
}
