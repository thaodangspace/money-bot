import type { ImageTransactionExtraction } from '../adapters/ai/image_types.ts';
import { MoneyService } from './money_service.ts';
import type { AIParser, AppendBatchResult, Ledger } from './types.ts';
import type { MonthlySummary } from '../domain/summary.ts';
import type { Transaction } from '../domain/transaction.ts';

class BatchAI implements AIParser {
  parseTransaction(): Promise<Transaction> {
    return Promise.reject(new Error('unused'));
  }
  parseImageTransactions(): Promise<ImageTransactionExtraction> {
    return Promise.resolve({
      kind: 'transaction_list',
      detected: 3,
      transactions: [
        { type: 'expense', category: 'drink', amount: 50_000, note: 'Cafe', date: '2026-07-18' },
        {
          type: 'expense',
          category: 'transport',
          amount: 120_000,
          note: 'Fuel',
          date: '2026-07-18',
        },
        { type: 'expense', category: 'food', amount: 75_000, note: 'Lunch', date: '2026-07-18' },
      ],
    });
  }
}

class BatchLedger implements Ledger {
  appended: Transaction[] = [];
  updates: number[] = [];
  appendTransactions(
    _signal: AbortSignal,
    updateId: number,
    transactions: Transaction[],
  ): Promise<AppendBatchResult> {
    this.updates.push(updateId);
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

Deno.test('image list previews and confirms all transactions in one write', async () => {
  const ledger = new BatchLedger();
  const service = new MoneyService({
    ledger,
    ai: new BatchAI(),
    clock: () => new Date('2026-07-18T10:00:00Z'),
  });
  const prepared = await service.prepareImage(new AbortController().signal, 77, {
    caption: '',
    mimeType: 'image/png',
    data: new Uint8Array([1]),
  });
  if (
    !prepared.text.includes('3 giao dịch') || !prepared.text.includes('18/07/2026') ||
    !prepared.text.includes('Tổng chi tiêu: 245.000')
  ) throw new Error(prepared.text);
  const previewWrites = ledger.appended.length;
  if (previewWrites !== 0) throw new Error('preview wrote to ledger');
  const result = await service.confirmImage(new AbortController().signal, prepared.token);
  const writeCount = ledger.appended.length;
  const updateCount = ledger.updates.length;
  if (!result.parsed || writeCount !== 3 || updateCount !== 1) {
    throw new Error(JSON.stringify({ result, ledger }));
  }
  if (ledger.appended.some((transaction) => transaction.sourceUpdateId !== 77)) {
    throw new Error('source update ID was not preserved');
  }
});
