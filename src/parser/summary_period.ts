import { normalizeForIntent } from './intent.ts';

export interface MonthlySummaryPeriod {
  year: number;
  month: number;
}

const PREVIOUS_PATTERN = /\bthang\s+(?:truoc|vua\s+roi)\b/u;
const CURRENT_PATTERN = /\bthang\s+nay\b/u;
const MONTH_YEAR_PATTERN = /\b(0?[1-9]|1[0-2])\s*\/\s*((?:19|20)\d{2})\b/u;
const YEAR_MONTH_PATTERN = /\b((?:19|20)\d{2})\s*(?:\/|\s|-)\s*(0?[1-9]|1[0-2])\b/u;
const NAMED_MONTH_PATTERN = /\bthang\s+(0?[1-9]|1[0-2])(?:\s*\/?\s*((?:19|20)\d{2}))?\b/u;
const BARE_MONTH_PATTERN = /^(0?[1-9]|1[0-2])(?:\s*\/?\s*((?:19|20)\d{2}))?$/u;

export function parseMonthlySummaryPeriod(
  input: string,
  now: Date,
  timeZone = 'Asia/Ho_Chi_Minh',
): MonthlySummaryPeriod | undefined {
  const normalized = normalizeForIntent(input);
  const current = currentPeriod(now, timeZone);
  if (!normalized) return current;

  let value = normalized;
  if (value.startsWith('/summary')) {
    value = value.slice('/summary'.length).trim();
    if (!value) return current;
  }
  if (!value || CURRENT_PATTERN.test(value)) return current;
  if (PREVIOUS_PATTERN.test(value)) return previousPeriod(current);

  const monthYear = MONTH_YEAR_PATTERN.exec(value);
  if (monthYear) return periodFromParts(monthYear[2]!, monthYear[1]!);
  const yearMonth = YEAR_MONTH_PATTERN.exec(value);
  if (yearMonth) return periodFromParts(yearMonth[1]!, yearMonth[2]!);
  const named = NAMED_MONTH_PATTERN.exec(value);
  if (named) return periodFromParts(named[2] ?? String(current.year), named[1]!);
  const bare = BARE_MONTH_PATTERN.exec(value);
  if (bare) return periodFromParts(bare[2] ?? String(current.year), bare[1]!);
  return undefined;
}

function currentPeriod(now: Date, timeZone: string): MonthlySummaryPeriod {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric' })
    .formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error('invalid clock date');
  return { year, month };
}

function previousPeriod(current: MonthlySummaryPeriod): MonthlySummaryPeriod {
  return current.month === 1
    ? { year: current.year - 1, month: 12 }
    : { year: current.year, month: current.month - 1 };
}

function periodFromParts(yearText: string, monthText: string): MonthlySummaryPeriod | undefined {
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return undefined;
  }
  return { year, month };
}
