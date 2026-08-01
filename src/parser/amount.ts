const AMOUNT_TOKEN_PATTERN = /^([0-9][0-9.,]*)(k|tr|m|đ|d)?([0-9]*)$/u;

export class InvalidAmountError extends Error {
  override name = 'InvalidAmountError';

  constructor(message = 'invalid amount') {
    super(message);
  }
}

export const ERR_INVALID_AMOUNT = 'invalid amount';

export function parseAmount(input: string): number {
  const token = input.trim().toLowerCase().replace(/\s+/gu, '');
  if (!token) throw new InvalidAmountError();

  const match = AMOUNT_TOKEN_PATTERN.exec(token);
  if (!match) throw new InvalidAmountError('invalid amount: malformed token');

  const numberPart = match[1];
  const suffix = match[2] ?? '';
  const remainder = match[3];
  if (!numberPart) throw new InvalidAmountError('invalid amount: malformed token');
  const [multiplier, compoundOK] = suffixMultiplier(suffix);

  if (remainder) {
    if (!compoundOK || /[.,]/u.test(numberPart)) {
      throw new InvalidAmountError('invalid amount: malformed compound token');
    }
    const main = parsePlainDigits(numberPart);
    const base = checkedMultiply(main, multiplier);
    const scale = powerOfTen(remainder.length);
    if (multiplier % scale !== 0) {
      throw new InvalidAmountError('invalid amount: compound precision below one dong');
    }
    const rem = parsePlainDigits(remainder);
    const fraction = checkedMultiply(rem, multiplier / scale);
    return positiveAmount(checkedAdd(base, fraction));
  }

  return positiveAmount(parseNumberPart(numberPart, suffix, multiplier));
}

function suffixMultiplier(suffix: string): [number, boolean] {
  switch (suffix) {
    case 'k':
      return [1_000, true];
    case 'tr':
    case 'm':
      return [1_000_000, true];
    case 'đ':
    case 'd':
    case '':
      return [1, false];
    default:
      return [0, false];
  }
}

function parseNumberPart(numberPart: string, suffix: string, multiplier: number): number {
  if (!/[.,]/u.test(numberPart)) {
    return checkedMultiply(parsePlainDigits(numberPart), multiplier);
  }
  if (groupedThousands(numberPart)) {
    return checkedMultiply(parsePlainDigits(removeSeparators(numberPart)), multiplier);
  }
  if (suffix === '' || suffix === 'đ' || suffix === 'd') {
    throw new InvalidAmountError('invalid amount: fractional dong');
  }

  const separator = decimalSeparator(numberPart);
  if (!separator) throw new InvalidAmountError('invalid amount: malformed separator');
  const parts = numberPart.split(separator);
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts.every(onlyDigits)) {
    throw new InvalidAmountError('invalid amount: malformed decimal');
  }
  const numerator = parsePlainDigits(parts[0] + parts[1]);
  const product = checkedMultiply(numerator, multiplier);
  const scale = powerOfTen(parts[1].length);
  if (product % scale !== 0) throw new InvalidAmountError('invalid amount: fractional dong');
  return product / scale;
}

function groupedThousands(value: string): boolean {
  const separator = value.includes('.') ? '.' : ',';
  const parts = value.split(separator);
  return parts.length >= 2 && parts.every(onlyDigits) && parts[0]!.length >= 1 &&
    parts.slice(1).every((part) => part.length === 3);
}

function decimalSeparator(value: string): string | undefined {
  const separators = [...value].filter((char) => char === '.' || char === ',');
  return separators.length === 1 ? separators[0] : undefined;
}

function removeSeparators(value: string): string {
  return value.replace(/[.,]/gu, '');
}

function parsePlainDigits(value: string): number {
  if (!value || !/^\d+$/u.test(value)) {
    throw new InvalidAmountError('invalid amount: expected digits');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new InvalidAmountError('invalid amount: overflow');
  return number;
}

function checkedMultiply(a: number, b: number): number {
  if (
    a < 0 || b < 0 || !Number.isSafeInteger(a) || !Number.isSafeInteger(b) ||
    (b !== 0 && a > Number.MAX_SAFE_INTEGER / b)
  ) {
    throw new InvalidAmountError('invalid amount: overflow');
  }
  return a * b;
}

function checkedAdd(a: number, b: number): number {
  if (a > Number.MAX_SAFE_INTEGER - b) throw new InvalidAmountError('invalid amount: overflow');
  return a + b;
}

function powerOfTen(exponent: number): number {
  const value = 10 ** exponent;
  if (!Number.isSafeInteger(value)) {
    throw new InvalidAmountError('invalid amount: precision overflow');
  }
  return value;
}

function positiveAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new InvalidAmountError('invalid amount: amount must be positive');
  }
  return amount;
}

function onlyDigits(value: string): boolean {
  return /^\d+$/u.test(value);
}
