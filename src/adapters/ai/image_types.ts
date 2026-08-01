import type { Transaction } from '../../domain/transaction.ts';

export const MAX_IMAGE_TRANSACTIONS = 20;
export type ImageExtractionKind = 'single_receipt' | 'single_transfer' | 'transaction_list';

export interface ImageTransactionExtraction {
  kind: ImageExtractionKind;
  detected: number;
  transactions: Transaction[];
}
