import type { PlainDate } from '../domain/transaction.ts';

export function currentPlainDate(now: Date, timeZone: string): PlainDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = part(parts, 'year');
  const month = part(parts, 'month').padStart(2, '0');
  const day = part(parts, 'day').padStart(2, '0');
  return `${year}-${month}-${day}` as PlainDate;
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  const value = parts.find((entry) => entry.type === type)?.value;
  if (!value) throw new Error(`clock did not provide ${type}`);
  return value;
}
