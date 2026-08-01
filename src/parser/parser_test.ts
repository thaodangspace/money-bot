import { InvalidAmountError, parseAmount } from './amount.ts';
import { detectMonthlySummaryIntent } from './intent.ts';
import { parseMonthlySummaryPeriod } from './summary_period.ts';
import {
  MAX_CATEGORY_RUNES,
  MAX_INPUT_RUNES,
  MAX_NOTE_RUNES,
  parseTransaction,
} from './transaction.ts';
import {
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
  transactionContent,
} from '../domain/transaction.ts';

Deno.test('parseAmount accepts Vietnamese amount forms', () => {
  const cases: Record<string, number> = {
    '150000': 150000,
    '150.000': 150000,
    '150,000': 150000,
    '150k': 150000,
    '150K': 150000,
    '1,5tr': 1500000,
    '1.5tr': 1500000,
    '1.25m': 1250000,
    '2k5': 2500,
    '2k05': 2050,
    '144tr300': 144300000,
    '20tr': 20000000,
    '1.000đ': 1000,
    '1,000d': 1000,
    '1.500k': 1500000,
    '999999999': 999999999,
    ' 150 k ': 150000,
  };
  for (const [input, expected] of Object.entries(cases)) equal(parseAmount(input), expected);
});

Deno.test('parseAmount rejects malformed, fractional, and unsafe values', () => {
  for (
    const input of [
      '',
      '0',
      '-1',
      'abc',
      '1,,000',
      '1.000,000',
      '1,5',
      '1,5đ',
      '2d5',
      '2k1234',
      '999999999999999999999999tr',
    ]
  ) {
    throws(() => parseAmount(input), InvalidAmountError);
  }
  throws(() => parseAmount('9007199254740992'), InvalidAmountError);
});

Deno.test('summary intent detection matches reports but not transactions', () => {
  for (
    const input of [
      'chi tiêu tháng này',
      'chi tieu thang nay',
      'Tổng chi tháng này đi',
      'xem chi thang nay',
      'thống kê tháng này',
      'bao cao thang nay',
      'báo cáo chi tiêu',
      'chi tiêu tháng 5',
      'tong chi thang 05/2026',
      '/summary',
      '/summary please',
    ]
  ) if (!detectMonthlySummaryIntent(input)) throw new Error(`not detected: ${input}`);
  for (
    const input of [
      'ăn tối 150k pizza',
      'thu lương 20tr',
      'bao gạo 100k tháng này',
      'summary 150k',
      '',
    ]
  ) {
    if (detectMonthlySummaryIntent(input)) throw new Error(`incorrectly detected: ${input}`);
  }
});

Deno.test('summary period parsing supports relative, named, and numeric periods', () => {
  const now = new Date('2026-07-18T10:00:00Z');
  const cases: Array<[string, number, number]> = [
    ['', 2026, 7],
    ['tháng này', 2026, 7],
    ['tháng trước', 2026, 6],
    ['tháng 5', 2026, 5],
    ['thang 05', 2026, 5],
    ['tháng 5/2025', 2025, 5],
    ['05/2025', 2025, 5],
    ['2025-05', 2025, 5],
    ['/summary tháng 5', 2026, 5],
    ['chi tiêu tháng 5', 2026, 5],
  ];
  for (const [input, year, month] of cases) {
    const actual = parseMonthlySummaryPeriod(input, now);
    if (!actual || actual.year !== year || actual.month !== month) {
      throw new Error(`${input}: ${JSON.stringify(actual)}`);
    }
  }
  for (const input of ['tháng 13', 'foo', '2025-13']) {
    if (parseMonthlySummaryPeriod(input, now)) throw new Error(`accepted: ${input}`);
  }
});

Deno.test('transaction parsing matches Vietnamese examples', () => {
  const cases: Array<[string, string, string, number, string, string]> = [
    ['ăn tối 150k pizza', 'Ăn tối', 'pizza', 150000, TRANSACTION_EXPENSE, 'Ăn tối pizza'],
    ['mua sắm 200000', 'Mua sắm', '', 200000, TRANSACTION_EXPENSE, 'Mua sắm'],
    ['thu lương 20tr tháng 7', 'Lương', 'tháng 7', 20000000, TRANSACTION_INCOME, 'Lương tháng 7'],
    ['nhận thưởng 2tr', 'Thưởng', '', 2000000, TRANSACTION_INCOME, 'Thưởng'],
    ['nhan thuong 2tr vui', 'Thuong', 'vui', 2000000, TRANSACTION_INCOME, 'Thuong vui'],
    ['cà phê 2k5', 'Cà phê', '', 2500, TRANSACTION_EXPENSE, 'Cà phê'],
    ['bán xe 144tr300 cũ', 'Bán xe', 'cũ', 144300000, TRANSACTION_EXPENSE, 'Bán xe cũ'],
    [
      'thu nhập phụ 1,5tr freelance',
      'Phụ',
      'freelance',
      1500000,
      TRANSACTION_INCOME,
      'Phụ freelance',
    ],
  ];
  for (const [input, category, note, amount, type, content] of cases) {
    const actual = parseTransaction(input);
    equal(actual.category, category);
    equal(actual.note, note);
    equal(actual.amount, amount);
    equal(actual.type, type);
    equal(transactionContent(actual), content);
  }
});

Deno.test('transaction parsing rejects invalid input and preserves Unicode limits', () => {
  const longCategory = 'x'.repeat(MAX_CATEGORY_RUNES + 1);
  const longNote = 'x'.repeat(MAX_NOTE_RUNES + 1);
  const longInput = 'x'.repeat(MAX_INPUT_RUNES + 1);
  for (
    const input of [
      '',
      '150k',
      'ăn tối',
      'ăn tối 0',
      'ăn tối -1',
      'ăn tối 1,5',
      'ăn tối 2k1234',
      longInput,
      `${longCategory} 1k`,
      `ăn 1k ${longNote}`,
    ]
  ) {
    throws(() => parseTransaction(input));
  }
  const actual = parseTransaction('  ăn    sáng   35k    bánh mì  ');
  equal(actual.category, 'Ăn sáng');
  equal(actual.note, 'bánh mì');
  equal(actual.amount, 35000);
});

function equal<T>(actual: T, expected: T): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}

function throws(fn: () => unknown, type?: new (...args: never[]) => Error): void {
  try {
    fn();
  } catch (error) {
    if (type && !(error instanceof type)) throw new Error(`wrong error type: ${String(error)}`);
    return;
  }
  throw new Error('expected function to throw');
}
