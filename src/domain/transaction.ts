export type TransactionType = 'expense' | 'income';

export const TRANSACTION_EXPENSE: TransactionType = 'expense';
export const TRANSACTION_INCOME: TransactionType = 'income';

/** A calendar date with no timezone or time-of-day component. */
export type PlainDate = `${number}-${number}-${number}`;

export interface Transaction {
  category: string;
  amount: number;
  note?: string;
  type: TransactionType;
  date?: PlainDate;
  sourceUpdateId?: number;
  originalMessage?: string;
}

export function isTransactionType(value: string): value is TransactionType {
  return value === TRANSACTION_EXPENSE || value === TRANSACTION_INCOME;
}

export function normalizeContentText(input: string | undefined): string {
  return (input ?? '').trim().split(/\s+/u).filter(Boolean).join(' ');
}

export function transactionContent(transaction: Transaction): string {
  const category = normalizeContentText(transaction.category);
  const original = normalizeContentText(transaction.originalMessage);
  if (original) return category ? `(${category}) ${original}` : original;

  const note = normalizeContentText(transaction.note);
  return [category, note].filter(Boolean).join(' ');
}

export function validateTransaction(transaction: Transaction): void {
  const errors: string[] = [];
  if (!isTransactionType(transaction.type)) {
    errors.push('transaction type must be "expense" or "income"');
  }
  if (!transaction.category.trim()) errors.push('transaction category is required');
  if (!Number.isSafeInteger(transaction.amount) || transaction.amount <= 0) {
    errors.push('transaction amount must be a positive safe integer');
  }
  if (errors.length > 0) throw new Error(errors.join('; '));
}
