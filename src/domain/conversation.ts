import { isTransactionType, type Transaction, validateTransaction } from './transaction.ts';

export type ConversationIntent =
  | { kind: 'record_transaction'; transaction: ConversationTransaction }
  | { kind: 'monthly_summary'; period: ConversationPeriod }
  | { kind: 'help' }
  | { kind: 'menu' }
  | { kind: 'greeting' }
  | { kind: 'clarify'; question: string }
  | { kind: 'unsupported'; reply: string };

export interface ConversationTransaction {
  type: 'expense' | 'income';
  category: string;
  amount: number;
  note: string;
}

export type ConversationPeriod =
  | { year: number; month: number }
  | { relative: 'current_month' | 'previous_month' };

export interface ConversationContext {
  lastIntent?: 'monthly_summary' | 'record_transaction';
  lastSummaryPeriod?: { year: number; month: number };
  pendingClarification?: {
    kind: 'record_transaction' | 'monthly_summary';
    missing: string[];
  };
  expiresAt: string;
}

const MAX_REPLY_RUNES = 500;
const MAX_MISSING_ITEMS = 8;

export function validateConversationIntent(intent: ConversationIntent): void {
  if (!isRecord(intent) || typeof intent.kind !== 'string') {
    throw new Error('conversation intent is invalid');
  }
  switch (intent.kind) {
    case 'record_transaction':
      assertObjectKeys(intent, ['kind', 'transaction']);
      if (!isRecord(intent.transaction)) throw new Error('conversation transaction is invalid');
      validateConversationTransaction(intent.transaction);
      return;
    case 'monthly_summary':
      assertObjectKeys(intent, ['kind', 'period']);
      validateConversationPeriod(intent.period);
      return;
    case 'clarify':
      assertObjectKeys(intent, ['kind', 'question']);
      if (!isBoundedText(intent.question, MAX_REPLY_RUNES)) {
        throw new Error('conversation question is invalid');
      }
      return;
    case 'unsupported':
      assertObjectKeys(intent, ['kind', 'reply']);
      if (!isBoundedText(intent.reply, MAX_REPLY_RUNES)) {
        throw new Error('conversation reply is invalid');
      }
      return;
    case 'help':
    case 'menu':
    case 'greeting':
      assertObjectKeys(intent, ['kind']);
      return;
    default:
      throw new Error('conversation intent is not allow-listed');
  }
}

export function validateConversationTransaction(value: ConversationTransaction): void {
  if (!isRecord(value)) throw new Error('conversation transaction is invalid');
  assertObjectKeys(value, ['type', 'category', 'amount', 'note']);
  if (!isTransactionType(value.type as string)) {
    throw new Error('conversation transaction type is invalid');
  }
  if (typeof value.category !== 'string' || typeof value.note !== 'string') {
    throw new Error('conversation transaction text is invalid');
  }
  const transaction: Transaction = {
    type: value.type,
    category: value.category.trim(),
    amount: value.amount,
    note: value.note.trim(),
  };
  try {
    validateTransaction(transaction);
  } catch (error) {
    throw new Error(`invalid conversation transaction: ${String(error)}`);
  }
  if (!transaction.category || Array.from(transaction.category).length > 120) {
    throw new Error('conversation category is invalid');
  }
  if (Array.from(transaction.note ?? '').length > 500) {
    throw new Error('conversation note is invalid');
  }
}

export function validateConversationPeriod(value: ConversationPeriod): void {
  if (!isRecord(value)) throw new Error('conversation period is invalid');
  const keys = Object.keys(value);
  if ('relative' in value) {
    if (
      keys.length !== 1 || value.relative !== 'current_month' && value.relative !== 'previous_month'
    ) {
      throw new Error('conversation relative period is invalid');
    }
    return;
  }
  const fieldCount: number = [...keys].length;
  if (
    !('year' in value) || !('month' in value) || fieldCount !== 2 ||
    !Number.isSafeInteger(value.year) || value.year < 1900 || value.year > 2200 ||
    !Number.isSafeInteger(value.month) || value.month < 1 || value.month > 12
  ) throw new Error('conversation absolute period is invalid');
}

function assertObjectKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error('conversation intent has extra fields');
  }
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    Array.from(value.trim()).length <= max;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const CONVERSATION_LIMITS = {
  maxReplyRunes: MAX_REPLY_RUNES,
  maxMissingItems: MAX_MISSING_ITEMS,
};
