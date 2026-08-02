import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
} from '../domain/transaction.ts';
import { AIAmbiguousInputError, InvalidAIOutputError } from '../adapters/ai/validation.ts';
import { MoneyService } from './money_service.ts';
import type { AIParser, AppendBatchResult, Ledger } from './types.ts';
import type { MonthlySummary } from '../domain/summary.ts';
import type { ImageTransactionExtraction } from '../adapters/ai/image_types.ts';

class FakeAI implements AIParser {
  parseTransaction(_signal: AbortSignal, _message: string): Promise<Transaction> {
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

class UnavailableAI extends FakeAI {
  transactionCalls = 0;

  override parseTransaction(): Promise<Transaction> {
    this.transactionCalls++;
    return Promise.reject(new Error('AI unavailable'));
  }
}

class AmbiguousAI extends FakeAI {
  override parseTransaction(): Promise<Transaction> {
    return Promise.reject(new AIAmbiguousInputError('no amount'));
  }
}

class InvalidAI extends FakeAI {
  override parseTransaction(): Promise<Transaction> {
    return Promise.reject(new InvalidAIOutputError('bad json'));
  }
}

class CountingAI extends FakeAI {
  transactionCalls = 0;

  override parseTransaction(signal: AbortSignal, message: string): Promise<Transaction> {
    this.transactionCalls++;
    return super.parseTransaction(signal, message);
  }
}

Deno.test('canonical transactions bypass AI and preserve parsed fields', async () => {
  const ai = new UnavailableAI();
  const ledger = new SimpleLedger();
  const service = new MoneyService({
    ledger,
    ai,
    clock: () => new Date('2026-07-18T10:00:00Z'),
  });

  const expense = await service.record(new AbortController().signal, 101, 'ăn tối 130k');
  const expenseWithNote = await service.record(
    new AbortController().signal,
    102,
    'ăn tối 130k vịt',
  );
  const income = await service.record(
    new AbortController().signal,
    103,
    'thu lương 20tr tháng 7',
  );

  if (ai.transactionCalls !== 0) throw new Error('canonical transaction called AI');
  if (expense.usedAI || expenseWithNote.usedAI || income.usedAI) {
    throw new Error('canonical transaction was marked as AI-parsed');
  }
  const [first, second, third] = ledger.appended;
  if (
    first?.type !== TRANSACTION_EXPENSE || first.amount !== 130_000 ||
    second?.type !== TRANSACTION_EXPENSE || second.amount !== 130_000 || second.note !== 'vịt' ||
    third?.type !== TRANSACTION_INCOME || third.amount !== 20_000_000 ||
    third.category !== 'Lương' || third.note !== 'tháng 7'
  ) throw new Error(JSON.stringify(ledger.appended));
  if (second.originalMessage !== 'ăn tối 130k vịt') {
    throw new Error(`original message: ${second.originalMessage}`);
  }
});

Deno.test('unrecognized transactions are delegated to AI', async () => {
  const ai = new CountingAI();
  const service = new MoneyService({ ledger: new SimpleLedger(), ai });

  const result = await service.record(new AbortController().signal, 104, 'paid the rent yesterday');

  if (!result.parsed || !result.usedAI || ai.transactionCalls !== 1) {
    throw new Error(JSON.stringify(result));
  }
  if (!result.text.includes('AI đã hỗ trợ')) throw new Error(result.text);
});

Deno.test('ambiguous AI input is reported without a syntax lecture or write', async () => {
  const service = new MoneyService({ ledger: new SimpleLedger(), ai: new AmbiguousAI() });
  const result = await service.record(new AbortController().signal, 105, 'ăn tối với bạn');
  if (result.parsed || result.duplicate) throw new Error(JSON.stringify(result));
  if (!result.text.includes('không nhận ra')) throw new Error(result.text);
});

Deno.test('temporary provider failure yields a retry-oriented message, not a usage error', async () => {
  const service = new MoneyService({ ledger: new SimpleLedger(), ai: new UnavailableAI() });
  const result = await service.record(new AbortController().signal, 106, 'đi xin vú ăn tiền lẻ ge');
  if (result.parsed) throw new Error(JSON.stringify(result));
  if (!result.text.includes('AI không khả dụng')) throw new Error(result.text);
});

Deno.test('invalid AI response yields a dedicated response message', async () => {
  const service = new MoneyService({ ledger: new SimpleLedger(), ai: new InvalidAI() });
  const result = await service.record(new AbortController().signal, 107, 'vốn chi đó xyz');
  if (result.parsed) throw new Error(JSON.stringify(result));
  if (!result.text.includes('không đọc được phản hồi')) throw new Error(result.text);
});

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
  if (
    !(await service.cancelImage(new AbortController().signal, tokens[0]!)).text.includes('Đã hủy')
  ) throw new Error('cancel failed');
  const afterCancel = service.pendingImageCount;
  if (afterCancel !== 15) throw new Error('cancel did not remove entry');
});

class SimpleLedger implements Ledger {
  appended: Transaction[] = [];

  appendTransactions(
    _signal: AbortSignal,
    _updateId: number,
    transactions: Transaction[],
  ): Promise<AppendBatchResult> {
    this.appended.push(...transactions);
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
