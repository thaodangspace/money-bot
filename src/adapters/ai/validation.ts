import {
  type ConversationIntent,
  type ConversationTransaction,
  validateConversationIntent,
  validateConversationPeriod,
  validateConversationTransaction,
} from '../../domain/conversation.ts';
import {
  isTransactionType,
  type PlainDate,
  type Transaction,
  type TransactionType,
  validateTransaction,
} from '../../domain/transaction.ts';
import {
  type ImageExtractionKind,
  type ImageTransactionExtraction,
  MAX_IMAGE_TRANSACTIONS,
} from './image_types.ts';

export class InvalidAIOutputError extends Error {
  override name = 'InvalidAIOutputError';
}

/** The model understood the request but reported that no transaction is present. */
export class AIAmbiguousInputError extends Error {
  override name = 'AIAmbiguousInputError';
}

export const MAX_AI_CATEGORY_RUNES = 120;
export const MAX_AI_NOTE_RUNES = 500;

export const CONVERSATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: [
        'record_transaction',
        'monthly_summary',
        'help',
        'menu',
        'greeting',
        'clarify',
        'unsupported',
      ],
    },
    transaction: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['expense', 'income'] },
        category: { type: 'string', minLength: 1, maxLength: MAX_AI_CATEGORY_RUNES },
        amount: { type: 'integer', minimum: 1 },
        note: { type: 'string', maxLength: MAX_AI_NOTE_RUNES },
      },
      required: ['type', 'category', 'amount', 'note'],
    },
    period: {
      type: 'object',
      additionalProperties: false,
      properties: {
        year: { type: 'integer', minimum: 1900, maximum: 2200 },
        month: { type: 'integer', minimum: 1, maximum: 12 },
        relative: { type: 'string', enum: ['current_month', 'previous_month'] },
      },
    },
    question: { type: 'string', minLength: 1, maxLength: 500 },
    reply: { type: 'string', minLength: 1, maxLength: 500 },
  },
  required: ['kind'],
} as const;

export function parseConversationIntentJSON(content: string): ConversationIntent {
  const value = parseBareObject(content);
  assertAllowedFields(value, new Set(['kind', 'transaction', 'period', 'question', 'reply']));
  if (typeof value.kind !== 'string') {
    throw new InvalidAIOutputError('conversation kind is invalid');
  }
  let intent: ConversationIntent;
  switch (value.kind) {
    case 'record_transaction':
      assertExactFields(value, ['kind', 'transaction']);
      if (!isRecord(value.transaction)) {
        throw new InvalidAIOutputError('conversation transaction missing');
      }
      assertAllowedFields(value.transaction, new Set(['type', 'category', 'amount', 'note']));
      intent = {
        kind: 'record_transaction',
        transaction: {
          type: value.transaction.type as ConversationTransaction['type'],
          category: value.transaction.category as string,
          amount: value.transaction.amount as number,
          note: value.transaction.note as string,
        },
      };
      break;
    case 'monthly_summary': {
      assertExactFields(value, ['kind', 'period']);
      if (!isRecord(value.period)) throw new InvalidAIOutputError('conversation period missing');
      assertAllowedFields(value.period, new Set(['year', 'month', 'relative']));
      const periodKeys = Object.keys(value.period);
      if (
        (periodKeys.includes('relative') && periodKeys.length !== 1) ||
        (!periodKeys.includes('relative') &&
          (periodKeys.length !== 2 || !periodKeys.includes('year') ||
            !periodKeys.includes('month')))
      ) throw new InvalidAIOutputError('conversation period has extra fields');
      if ('relative' in value.period && value.period.relative !== undefined) {
        intent = {
          kind: 'monthly_summary',
          period: { relative: value.period.relative as 'current_month' | 'previous_month' },
        };
      } else {
        intent = {
          kind: 'monthly_summary',
          period: {
            year: value.period.year as number,
            month: value.period.month as number,
          },
        };
      }
      break;
    }
    case 'help':
      assertExactFields(value, ['kind']);
      intent = { kind: 'help' };
      break;
    case 'menu':
      assertExactFields(value, ['kind']);
      intent = { kind: 'menu' };
      break;
    case 'greeting':
      assertExactFields(value, ['kind']);
      intent = { kind: 'greeting' };
      break;
    case 'clarify':
      assertExactFields(value, ['kind', 'question']);
      intent = { kind: 'clarify', question: value.question as string };
      break;
    case 'unsupported':
      assertExactFields(value, ['kind', 'reply']);
      intent = { kind: 'unsupported', reply: value.reply as string };
      break;
    default:
      throw new InvalidAIOutputError('conversation kind is not allow-listed');
  }
  try {
    validateConversationIntent(intent);
    if (intent.kind === 'monthly_summary') validateConversationPeriod(intent.period);
    if (intent.kind === 'record_transaction') validateConversationTransaction(intent.transaction);
  } catch (error) {
    if (error instanceof AIAmbiguousInputError) throw error;
    throw new InvalidAIOutputError(String(error));
  }
  return intent;
}

/** JSON Schema used for the strongest supported structured-output request. */
export const TRANSACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['expense', 'income'] },
    category: { type: 'string', minLength: 1, maxLength: MAX_AI_CATEGORY_RUNES },
    amount: { type: 'integer', minimum: 1 },
    note: { type: 'string', maxLength: MAX_AI_NOTE_RUNES },
  },
  required: ['type', 'category', 'amount', 'note'],
} as const;

export function parseTransactionJSON(content: string): Transaction {
  const value = parseBareObject(content);
  return parseTransactionValue(value);
}

export function parseImageTransactionsJSON(
  content: string,
  now = new Date(),
): ImageTransactionExtraction {
  const value = parseBareObject(content);
  const allowed = new Set(['error', 'kind', 'detected', 'transactions']);
  assertAllowedFields(value, allowed);
  if (typeof value.error === 'string' && value.error.trim()) {
    throw new InvalidAIOutputError('AI reported unknown image');
  }
  const kind = typeof value.kind === 'string' ? value.kind.trim().toLowerCase() : '';
  if (!isImageExtractionKind(kind)) {
    throw new InvalidAIOutputError('AI image extraction kind is invalid');
  }
  if (
    typeof value.detected !== 'number' || !Number.isSafeInteger(value.detected) ||
    value.detected < 1 || value.detected > MAX_IMAGE_TRANSACTIONS
  ) {
    throw new InvalidAIOutputError('AI image detected count is invalid');
  }
  if (
    !Array.isArray(value.transactions) || value.transactions.length < 1 ||
    value.transactions.length > MAX_IMAGE_TRANSACTIONS
  ) {
    throw new InvalidAIOutputError('AI image transaction count is invalid');
  }
  if (kind !== 'transaction_list' && (value.detected !== 1 || value.transactions.length !== 1)) {
    throw new InvalidAIOutputError('single image extraction must contain one transaction');
  }
  if (kind === 'transaction_list' && value.detected !== value.transactions.length) {
    throw new InvalidAIOutputError('AI image transaction list is incomplete');
  }

  const transactions: Transaction[] = [];
  const seen = new Set<string>();
  for (const item of value.transactions) {
    if (!isRecord(item)) throw new InvalidAIOutputError('AI image transaction is invalid');
    const transaction = parseTransactionValue(
      item,
      new Set(['type', 'category', 'amount', 'note', 'date']),
    );
    const dateValue = item.date;
    if (dateValue !== undefined) {
      if (typeof dateValue !== 'string' || !isPlainDate(dateValue)) {
        throw new InvalidAIOutputError('AI image transaction date is invalid');
      }
      if (plainDateAfter(dateValue, now)) {
        throw new InvalidAIOutputError('AI image transaction date is in the future');
      }
      transaction.date = dateValue;
    }
    const key = [
      transaction.type,
      transaction.category,
      transaction.amount,
      transaction.note ?? '',
      transaction.date ?? '',
    ].join('\u0000');
    if (seen.has(key)) throw new InvalidAIOutputError('duplicate AI image transaction');
    seen.add(key);
    transactions.push(transaction);
  }
  return { kind, detected: value.detected, transactions };
}

function parseTransactionValue(
  value: Record<string, unknown>,
  allowed = new Set(['error', 'type', 'category', 'amount', 'note']),
): Transaction {
  assertAllowedFields(value, allowed);
  if (typeof value.error === 'string' && value.error.trim()) {
    throw new AIAmbiguousInputError('AI reported unknown transaction');
  }
  if (typeof value.type !== 'string' || !isTransactionType(value.type.trim().toLowerCase())) {
    throw new InvalidAIOutputError('AI transaction type is invalid');
  }
  if (typeof value.category !== 'string' || typeof value.note !== 'string') {
    throw new InvalidAIOutputError('AI category and note must be strings');
  }
  if (
    typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount <= 0
  ) throw new InvalidAIOutputError('AI amount must be a positive safe integer');
  const transaction: Transaction = {
    type: value.type.trim().toLowerCase() as TransactionType,
    category: normalize(value.category),
    amount: value.amount,
    note: normalize(value.note),
  };
  if (Array.from(transaction.category).length > MAX_AI_CATEGORY_RUNES) {
    throw new InvalidAIOutputError('AI category is too long');
  }
  if (Array.from(transaction.note ?? '').length > MAX_AI_NOTE_RUNES) {
    throw new InvalidAIOutputError('AI note is too long');
  }
  try {
    validateTransaction(transaction);
  } catch (error) {
    throw new InvalidAIOutputError(`invalid AI transaction: ${String(error)}`);
  }
  return transaction;
}

function parseBareObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new InvalidAIOutputError('AI output must be one bare JSON object');
  }
  if (hasDuplicateObjectKeys(trimmed)) {
    throw new InvalidAIOutputError('AI output contains duplicate fields');
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    throw new InvalidAIOutputError(`invalid AI JSON: ${String(error)}`);
  }
  if (!isRecord(value)) throw new InvalidAIOutputError('AI output must be a JSON object');
  return value;
}

function assertExactFields(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new InvalidAIOutputError('conversation intent has extra fields');
  }
}

function assertAllowedFields(value: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new InvalidAIOutputError(`unknown AI field: ${key}`);
  }
}
function normalize(value: string): string {
  return value.trim().split(/\s+/u).filter(Boolean).join(' ');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isImageExtractionKind(value: string): value is ImageExtractionKind {
  return value === 'single_receipt' || value === 'single_transfer' || value === 'transaction_list';
}
function isPlainDate(value: string): value is PlainDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}
function plainDateAfter(value: PlainDate, now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return !!year && !!month && !!day && value > `${year}-${month}-${day}`;
}

function hasDuplicateObjectKeys(json: string): boolean {
  const objects: Array<Set<string>> = [];
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (char === '{') {
      objects.push(new Set());
      continue;
    }
    if (char === '}') {
      objects.pop();
      continue;
    }
    if (char !== '"' || objects.length === 0) continue;
    const start = index;
    let escaped = false;
    index++;
    for (; index < json.length; index++) {
      const current = json[index];
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') break;
    }
    const keyText = json.slice(start, index + 1);
    let after = index + 1;
    while (/\s/u.test(json[after] ?? '')) after++;
    if (json[after] === ':') {
      let key: unknown;
      try {
        key = JSON.parse(keyText);
      } catch {
        continue;
      }
      if (typeof key === 'string') {
        const keys = objects[objects.length - 1]!;
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
  return false;
}
