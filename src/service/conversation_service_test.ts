import type { ConversationContext, ConversationIntent } from '../domain/conversation.ts';
import type { MonthlySummary } from '../domain/summary.ts';
import type { ImageTransactionExtraction } from '../adapters/ai/image_types.ts';
import type { Transaction } from '../domain/transaction.ts';
import type { AIParser, AppendBatchResult, ConversationRouter, Ledger } from './types.ts';
import { MoneyService } from './money_service.ts';

class FakeAI implements AIParser {
  parseTransaction(): Promise<Transaction> {
    return Promise.reject(new Error('legacy parser must not be called'));
  }
  parseImageTransactions(): Promise<ImageTransactionExtraction> {
    return Promise.reject(new Error('not used'));
  }
}

class FakeRouter implements ConversationRouter {
  readonly intents: ConversationIntent[];
  calls: string[] = [];

  constructor(...intents: ConversationIntent[]) {
    this.intents = intents;
  }
  route(
    _signal: AbortSignal,
    input: { message: string; now: string; timeZone: string; context?: ConversationContext },
  ): Promise<ConversationIntent> {
    this.calls.push(input.message);
    return Promise.resolve(this.intents.shift()!);
  }
}

class FakeLedger implements Ledger {
  appended: Transaction[] = [];
  summaries: Array<{ year: number; month: number }> = [];

  appendTransactions(
    _signal: AbortSignal,
    _updateId: number,
    transactions: Transaction[],
  ): Promise<AppendBatchResult> {
    this.appended.push(...transactions);
    return Promise.resolve({ status: 'written', targetSheets: ['2026-07'] });
  }
  monthlySummary(_signal: AbortSignal, year: number, month: number): Promise<MonthlySummary> {
    this.summaries.push({ year, month });
    return Promise.resolve({
      year,
      month,
      totalExpenses: 150_000,
      totalIncome: 0,
      balance: -150_000,
      entryCount: 1,
    });
  }
}

Deno.test('handleText routes transactions and summaries without a second parser call', async () => {
  const router = new FakeRouter(
    {
      kind: 'record_transaction',
      transaction: { type: 'expense', category: 'food', amount: 150_000, note: 'ăn tối' },
    },
    { kind: 'monthly_summary', period: { relative: 'current_month' } },
    { kind: 'clarify', question: 'Bạn muốn xem tháng nào?' },
    { kind: 'monthly_summary', period: { year: 2026, month: 5 } },
  );
  const ledger = new FakeLedger();
  const service = new MoneyService({
    ai: new FakeAI(),
    router,
    ledger,
    clock: () => new Date('2026-07-18T10:00:00Z'),
  });

  const recorded = await service.handleText(new AbortController().signal, 1, 'ghi 150k ăn tối');
  if (!recorded.parsed || ledger.appended.length !== 1 || ledger.appended[0]?.amount !== 150_000) {
    throw new Error(JSON.stringify(recorded));
  }
  const report = await service.handleText(
    new AbortController().signal,
    2,
    'tháng này tiêu bao nhiêu?',
  );
  if (ledger.summaries[0]?.year !== 2026 || ledger.summaries[0]?.month !== 7 || !report.text) {
    throw new Error(JSON.stringify(report));
  }
  const clarification = await service.handleText(new AbortController().signal, 3, 'xem báo cáo');
  if (clarification.parsed || clarification.context || ledger.appended.length !== 1) {
    throw new Error(JSON.stringify(clarification));
  }
  const explicitReport = await service.handleText(new AbortController().signal, 4, 'tháng 5');
  if (ledger.summaries[1]?.year !== 2026 || ledger.summaries[1]?.month !== 5) {
    throw new Error(JSON.stringify(explicitReport));
  }
  if (router.calls.length !== 4) throw new Error(`route calls: ${router.calls.length}`);
});
