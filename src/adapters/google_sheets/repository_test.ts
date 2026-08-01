import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
} from '../../domain/transaction.ts';
import { SheetsRepository } from './repository.ts';
import {
  type BatchUpdateRequest,
  METADATA_HEADERS,
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
  const summary = await repository.monthlySummary(new AbortController().signal, 2026, 7);
  if (
    summary.totalExpenses !== 200_000 || summary.totalIncome !== 2_200_000 ||
    summary.entryCount !== 4 || summary.balance !== 2_000_000
  ) {
    throw new Error(JSON.stringify(summary));
  }
});
