import {
  isTransactionType,
  type Transaction,
  type TransactionType,
  validateTransaction,
} from '../../domain/transaction.ts';

export class InvalidAIOutputError extends Error {
  override name = 'InvalidAIOutputError';
}

export const MAX_AI_CATEGORY_RUNES = 120;
export const MAX_AI_NOTE_RUNES = 500;

export function parseTransactionJSON(content: string): Transaction {
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
  if (!isPlainObject(value)) throw new InvalidAIOutputError('AI output must be a JSON object');

  const allowed = new Set(['error', 'type', 'category', 'amount', 'note']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new InvalidAIOutputError(`unknown AI field: ${key}`);
  }
  if (typeof value.error === 'string' && value.error.trim()) {
    throw new InvalidAIOutputError('AI reported unknown transaction');
  }
  if (typeof value.type !== 'string' || !isTransactionType(value.type.trim().toLowerCase())) {
    throw new InvalidAIOutputError('AI transaction type is invalid');
  }
  if (typeof value.category !== 'string' || typeof value.note !== 'string') {
    throw new InvalidAIOutputError('AI category and note must be strings');
  }
  if (
    typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount <= 0
  ) {
    throw new InvalidAIOutputError('AI amount must be a positive safe integer');
  }

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

function normalize(value: string): string {
  return value.trim().split(/\s+/u).filter(Boolean).join(' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      if (escaped) {
        escaped = false;
      } else if (current === '\\\\') {
        escaped = true;
      } else if (current === '"') {
        break;
      }
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
