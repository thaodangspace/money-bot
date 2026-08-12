import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
  TRANSACTION_INVEST,
  TRANSACTION_SAVING,
} from '../../domain/transaction.ts';
import { SheetsRepository } from './repository.ts';
import {
  type BatchUpdateRequest,
  METADATA_HEADERS,
  SheetNotFoundError,
  type SheetsAPI,
  type Spreadsheet,
} from './types.ts';

class FakeSheets implements SheetsAPI {
  spreadsheet: Spreadsheet = {
    sheets: [
      { id: 1, title: '2026-07', hidden: false },
      { id: 2, title: '2026-08', hidden: false },
      { id: 3, title: '_money_bot_meta', hidden: true },
    ],
  };
  values = new Map<string, string[][]>([
    ["'_money_bot_meta'!A1:E1", [METADATA_HEADERS]],
    ["'_money_bot_meta'!A2:E", []],
  ]);
  batches: BatchUpdateRequest[] = [];

  getSpreadsheet(): Promise<Spreadsheet> {
    return Promise.resolve(this.spreadsheet);
  }

  getValues(_signal: AbortSignal, _id: string, range: string): Promise<string[][]> {
    return Promise.resolve(this.values.get(range) ?? []);
  }

  batchUpdate(_signal: AbortSignal, _id: string, request: BatchUpdateRequest): Promise<void> {
    this.batches.push(request);
    for (const item of request.requests) {
      if (item.appendCells) {
        const range = item.appendCells.sheetTitle === '_money_bot_meta'
          ? (item.appendCells.values[0]?.[0] === 'Schema Version'
            ? "'_money_bot_meta'!A1:E1"
            : "'_money_bot_meta'!A2:E")
          : `'${item.appendCells.sheetTitle}'!A:D`;
        this.values.set(range, [...(this.values.get(range) ?? []), ...item.appendCells.values]);
      }
    }
    return Promise.resolve();
  }
}

class MissingSheets extends FakeSheets {
  override getValues(signal: AbortSignal, id: string, range: string): Promise<string[][]> {
    if (range.includes("'2026-09'") || range.includes("'9'")) {
      return Promise.reject(new SheetNotFoundError('worksheet missing'));
    }
    return super.getValues(signal, id, range);
  }
}

Deno.test('repository appends cross-month transactions and one metadata row atomically', async () => {
  const api = new FakeSheets();
  const repository = new SheetsRepository({
    api,
    spreadsheetId: 'spreadsheet',
    clock: () => new Date('2026-07-18T10:00:00Z'),
  });
  const transactions: Transaction[] = [
    {
      category: 'food',
      originalMessage: 'ăn tối 150k',
      amount: 150_000,
      type: TRANSACTION_EXPENSE,
      date: '2026-07-18',
    },
    { category: 'salary', amount: 2_000_000, type: TRANSACTION_INCOME, date: '2026-08-01' },
  ];
  const result = await repository.appendTransactions(
    new AbortController().signal,
    99,
    transactions,
  );
  if (result.status !== 'written' || result.targetSheets.join(',') !== '2026-07,2026-08') {
    throw new Error(JSON.stringify(result));
  }
  if (api.batches.length !== 1 || api.batches[0]!.requests.length !== 3) {
    throw new Error(JSON.stringify(api.batches));
  }
  const first = api.batches[0]!.requests[0]!.appendCells;
  const metadata = api.batches[0]!.requests[2]!.appendCells;
  if (first?.values[0]?.join('|') !== '18/07/2026|expense|(food) ăn tối 150k|150000') {
    throw new Error(JSON.stringify(first));
  }
  if (metadata?.values[0]?.[1] !== '99' || metadata.values[0]?.[3] !== '2026-07,2026-08') {
    throw new Error(JSON.stringify(metadata));
  }
});

Deno.test('repository writes and reports invest and saving buckets', async () => {
  const api = new FakeSheets();
  const repository = new SheetsRepository({ api, spreadsheetId: 'spreadsheet' });
  const result = await repository.appendTransactions(new AbortController().signal, 100, [
    { category: 'crypto', amount: 5_000_000, type: TRANSACTION_INVEST, date: '2026-07-18' },
    { category: 'bank', amount: 8_000_000, type: TRANSACTION_SAVING, date: '2026-07-19' },
  ]);
  if (result.status !== 'written') throw new Error(JSON.stringify(result));
  const rows = api.batches[0]?.requests.slice(0, 2).map((request) =>
    request.appendCells?.values[0]?.slice(1, 2)[0]
  );
  if (rows?.join(',') !== 'invest,saving') throw new Error(JSON.stringify(rows));

  const report = await repository.monthlyReport(new AbortController().signal, 2026, 7);
  if (
    report.summary.totalInvest !== 5_000_000 || report.summary.totalSaving !== 8_000_000 ||
    report.summary.totalExpenses !== 0 || report.summary.totalIncome !== 0 ||
    report.summary.balance !== -13_000_000 || report.rows.length !== 2
  ) throw new Error(JSON.stringify(report));
});

Deno.test('repository suppresses a duplicate update ID before writing', async () => {
  const api = new FakeSheets();
  api.values.set("'_money_bot_meta'!A2:E", [[
    '1',
    '99',
    '2026-07-18T00:00:00Z',
    '2026-07',
    'written',
  ]]);
  const repository = new SheetsRepository({ api, spreadsheetId: 'spreadsheet' });
  const result = await repository.appendTransactions(new AbortController().signal, 99, [
    { category: 'food', amount: 1, type: TRANSACTION_EXPENSE, date: '2026-07-18' },
  ]);
  if (result.status !== 'duplicate' || api.batches.length !== 0) {
    throw new Error(JSON.stringify(result));
  }
});

Deno.test('repository combines flat and legacy summary rows safely', async () => {
  const api = new FakeSheets();
  api.values.set("'2026-07'!A:D", [
    ['18/07/2026', 'expense', 'food', '150000'],
    ['19/07/2026', 'income', 'salary', '2000000'],
    ['18/06/2026', 'expense', 'old', '999'],
    ['18/07/2026', 'other', 'ignored', '100'],
  ]);
  api.values.set("'7'!A2:D", [
    ['18/07/2026', '', '', ''],
    ['meal', '50.000', '200.000'],
    ['18/08/2026', '', '', ''],
    ['wrong month', '999999', '999999'],
  ]);
  const repository = new SheetsRepository({ api, spreadsheetId: 'spreadsheet' });
  const report = await repository.monthlyReport(new AbortController().signal, 2026, 7);
  const summary = report.summary;
  if (
    summary.totalExpenses !== 200_000 || summary.totalIncome !== 2_200_000 ||
    summary.entryCount !== 4 || summary.balance !== 2_000_000 ||
    report.rows.length !== summary.entryCount || report.rows[0]?.content !== 'food' ||
    report.rows[1]?.content !== 'meal' || report.rows[2]?.content !== 'meal' ||
    report.rows[3]?.content !== 'salary' || report.rows[1]?.type !== 'expense' ||
    report.rows[2]?.type !== 'income'
  ) {
    throw new Error(JSON.stringify(report));
  }
});

Deno.test('repository scans all supported sheets for the all-time summary', async () => {
  const api = new FakeSheets();
  api.spreadsheet.sheets.push(
    { id: 4, title: '7', hidden: false },
    { id: 5, title: '2026-13', hidden: false },
    { id: 6, title: 'notes', hidden: false },
  );
  api.values.set("'2026-07'!A:D", [
    ['18/07/2026', 'income', 'salary', '1000000'],
    ['19/07/2026', 'expense', 'meal', '200000'],
    ['20/06/2026', 'income', 'wrong month', '999999'],
    ['21/07/2026', 'invest', 'fund', '100000'],
    ['22/07/2026', 'saving', 'bank', '50000'],
  ]);
  api.values.set("'2026-08'!A:D", [
    ['01/08/2026', 'income', 'salary', '2000000'],
    ['02/08/2026', 'expense', 'meal', '300000'],
  ]);
  api.values.set("'7'!A2:D", [
    ['18/07/2025', '', '', ''],
    ['old meal', '10.000', '20.000'],
    ['19/07/2026', '', '', ''],
    ['new meal', '30.000', '40.000'],
    ['18/08/2026', '', '', ''],
    ['wrong month', '999999', '999999'],
  ]);
  const summary = await new SheetsRepository({ api, spreadsheetId: 'spreadsheet' }).allTimeSummary(
    new AbortController().signal,
  );
  if (
    summary.totalIncome !== 3_060_000 || summary.totalExpenses !== 540_000 ||
    summary.totalInvest !== 100_000 || summary.totalSaving !== 50_000 ||
    summary.cashAvailable !== 2_370_000 || summary.entryCount !== 10 ||
    summary.firstTransactionDate !== '18/07/2025' || summary.lastTransactionDate !== '02/08/2026'
  ) throw new Error(JSON.stringify(summary));
});

Deno.test('repository treats missing current and legacy worksheets as an empty report', async () => {
  const repository = new SheetsRepository({
    api: new MissingSheets(),
    spreadsheetId: 'spreadsheet',
  });
  const report = await repository.monthlyReport(new AbortController().signal, 2026, 9);
  if (report.rows.length !== 0 || report.summary.entryCount !== 0) {
    throw new Error(JSON.stringify(report));
  }
});
