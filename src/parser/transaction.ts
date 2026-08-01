import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
  validateTransaction,
} from '../domain/transaction.ts';
import { normalizeForIntent } from './intent.ts';
import { parseAmount } from './amount.ts';

export const MAX_INPUT_RUNES = 2_000;
export const MAX_CATEGORY_RUNES = 120;
export const MAX_NOTE_RUNES = 500;

export class TransactionNotRecognizedError extends Error {
  override name = 'TransactionNotRecognizedError';

  constructor(message = 'transaction not recognized') {
    super(message);
  }
}

const TRANSACTION_PATTERN = /^(.+?)\s+([0-9][0-9.,]*\s*(?:k|tr|m|đ|d)?\d*)(?:\s+(.*))?$/u;

export function parseTransaction(input: string): Transaction {
  const trimmed = input.trim();
  if (!trimmed) throw new TransactionNotRecognizedError();
  if (runeLength(trimmed) > MAX_INPUT_RUNES) {
    throw new TransactionNotRecognizedError('transaction not recognized: input too long');
  }

  let type = TRANSACTION_EXPENSE;
  let text = trimmed;
  const incomePrefix = trimIncomePrefix(text);
  if (incomePrefix !== undefined) {
    type = TRANSACTION_INCOME;
    text = incomePrefix.trim();
  }
  if (!text) throw new TransactionNotRecognizedError();

  const match = TRANSACTION_PATTERN.exec(text);
  if (!match) throw new TransactionNotRecognizedError();
  const category = normalizeText(match[1]!);
  const amountToken = normalizeText(match[2]!);
  const note = match[3] === undefined ? '' : normalizeText(match[3]);
  if (!category) throw new TransactionNotRecognizedError();
  if (runeLength(category) > MAX_CATEGORY_RUNES) {
    throw new TransactionNotRecognizedError('transaction not recognized: category too long');
  }
  if (runeLength(note) > MAX_NOTE_RUNES) {
    throw new TransactionNotRecognizedError('transaction not recognized: note too long');
  }

  const transaction: Transaction = {
    category: capitalizeFirst(category),
    amount: parseAmount(amountToken),
    note,
    type,
  };
  validateTransaction(transaction);
  return transaction;
}

function trimIncomePrefix(input: string): string | undefined {
  const normalized = normalizeForIntent(input);
  for (const prefix of ['thu nhap', 'nhan', 'thu']) {
    if (normalized === prefix) return '';
    if (normalized.startsWith(`${prefix} `)) {
      return trimLeadingWords(input, prefix.split(' ').length);
    }
  }
  return undefined;
}

function trimLeadingWords(input: string, count: number): string {
  let value = input.trim();
  while (count > 0 && value) {
    const match = /^\S+/u.exec(value);
    if (!match) return '';
    value = value.slice(match[0].length).trim();
    count--;
  }
  return value;
}

function normalizeText(input: string): string {
  return input.trim().split(/\s+/u).filter(Boolean).join(' ');
}

function capitalizeFirst(input: string): string {
  const characters = Array.from(input.trim());
  if (characters.length === 0) return '';
  characters[0] = characters[0]!.toLocaleUpperCase('vi-VN');
  return characters.join('');
}

function runeLength(value: string): number {
  return Array.from(value).length;
}
