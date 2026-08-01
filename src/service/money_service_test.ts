import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
} from '../domain/transaction.ts';
import { MoneyService } from './money_service.ts';
import type { AIParser, AppendBatchResult, Ledger } from './types.ts';
import type { MonthlySummary } from '../domain/summary.ts';
import type { ImageTransactionExtraction } from '../adapters/ai/image_types.ts';

class FakeAI implements AIParser {
  parseTransaction(): Promise<Transaction> {
    return Promise.resolve({
      category: 'food',
      note: 'receipt',
      amount: 150_000,
      type: TRANSACTION_EXPENSE,
    });
  }

  parseImageTransactions(): Promise<ImageTransactionExtraction> {
    return Promise.resolve({
      kind: 'single_transfer',
      detected: 1,
      transactions: [{
        category: 'salary',
        note: 'transfer',
        amount: 2_000_000,
        type: TRANSACTION_INCOME,
      }],
    });
  }
}

class BlockingLedger implements Ledger {
  appendCalls = 0;
  appended: Transaction[] = [];
  release!: () => void;
  readonly started: Promise<void>;
  #resolveStarted!: () => void;
  #status: AppendBatchResult = { status: 'written', targetSheets: ['2026-07'] };

  constructor() {
    this.started = new Promise((resolve) => this.#resolveStarted = resolve);
  }

  async appendTransactions(
    _signal: AbortSignal,
    _updateId: number,
    transactions: Transaction[],
  ): Promise<AppendBatchResult> {
    this.appendCalls++;
    this.appended.push(...transactions);
    this.#resolveStarted();
    await new Promise<void>((resolve) => this.release = resolve);
    return this.#status;
  }

  monthlySummary(): Promise<MonthlySummary> {
    return Promise.resolve({
      year: 2026,
      month: 7,
      totalExpenses: 0,
      totalIncome: 0,
      balance: 0,
      entryCount: 0,
    });
  }
}

Deno.test('image confirmation marks confirming before the ledger await', async () => {
  const ledger = new BlockingLedger();
  const service = new MoneyService({
    ledger,
    ai: new FakeAI(),
    clock: () => new Date('2026-07-18T23:00:00Z'),
  });
  const prepared = await service.prepareImage(new AbortController().signal, 99, {
    caption: 'ignored after extraction',
    mimeType: 'image/jpeg',
    data: new Uint8Array([1]),
  });

  const first = service.confirmImage(new AbortController().signal, prepared.token);
  await ledger.started;
  const second = await service.confirmImage(new AbortController().signal, prepared.token);
  if (!second.text.includes('không còn hiệu lực')) throw new Error(second.text);
  if (ledger.appendCalls !== 1) throw new Error(`append calls: ${ledger.appendCalls}`);

  ledger.release();
  const result = await first;
  if (!result.parsed || service.pendingImageCount !== 0) throw new Error(JSON.stringify(result));
  if (ledger.appended[0]?.date !== '2026-07-19') {
    throw new Error(JSON.stringify(ledger.appended[0]));
  }
});

Deno.test('failed image writes release the confirmation for retry', async () => {
  let fail = true;
  const ledger: Ledger = {
    appendTransactions(_signal, _updateId, _transactions) {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('sheets unavailable'));
      }
      return Promise.resolve({ status: 'written', targetSheets: ['2026-07'] });
    },
    monthlySummary() {
      return Promise.resolve({
        year: 2026,
        month: 7,
        totalExpenses: 0,
        totalIncome: 0,
        balance: 0,
        entryCount: 0,
      });
    },
  };
  const service = new MoneyService({ ledger, ai: new FakeAI() });
  const prepared = await service.prepareImage(new AbortController().signal, 1, {
    caption: '',
    mimeType: 'image/png',
    data: new Uint8Array([1]),
  });
  let failed = false;
  try {
    await service.confirmImage(new AbortController().signal, prepared.token);
  } catch {
    failed = true;
  }
  if (!failed) throw new Error('first confirmation unexpectedly succeeded');
  const retried = await service.confirmImage(new AbortController().signal, prepared.token);
  if (!retried.parsed || service.pendingImageCount !== 0) throw new Error(JSON.stringify(retried));
});

Deno.test('image pending capacity and cancellation are bounded', async () => {
  const service = new MoneyService({ ledger: new SimpleLedger(), ai: new FakeAI() });
  const tokens: string[] = [];
  for (let index = 0; index < 16; index++) {
    const prepared = await service.prepareImage(new AbortController().signal, index + 1, {
      caption: '',
      mimeType: 'image/webp',
      data: new Uint8Array([1]),
    });
    tokens.push(prepared.token);
  }
  let rejected = false;
  try {
    await service.prepareImage(new AbortController().signal, 17, {
      caption: '',
      mimeType: 'image/webp',
      data: new Uint8Array([1]),
    });
  } catch {
    rejected = true;
  }
  const beforeCancel = service.pendingImageCount;
  if (!rejected || beforeCancel !== 16) {
    throw new Error('pending capacity was not enforced');
  }
  if (!service.cancelImage(tokens[0]!).text.includes('Đã hủy')) throw new Error('cancel failed');
  const afterCancel = service.pendingImageCount;
  if (afterCancel !== 15) throw new Error('cancel did not remove entry');
});

class SimpleLedger implements Ledger {
  appendTransactions(): Promise<AppendBatchResult> {
    return Promise.resolve({ status: 'written', targetSheets: ['2026-07'] });
  }

  monthlySummary(): Promise<MonthlySummary> {
    return Promise.resolve({
      year: 2026,
      month: 7,
      totalExpenses: 0,
      totalIncome: 0,
      balance: 0,
      entryCount: 0,
    });
  }
}
