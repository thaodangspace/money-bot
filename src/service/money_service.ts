import { parseMonthlySummaryPeriod } from '../parser/summary_period.ts';
import { detectMonthlySummaryIntent } from '../parser/intent.ts';
import { currentPlainDate } from '../shared/calendar.ts';
import { type Clock, systemClock } from '../shared/runtime.ts';
import type { Transaction } from '../domain/transaction.ts';
import { validateTransaction } from '../domain/transaction.ts';
import {
  boundText,
  duplicateText,
  formatSummary,
  imageConfirmationUnavailableText,
  imagePreviewText,
  successText,
  summaryUsageText,
  usageText,
} from './format.ts';
import { ImagePendingStore } from './image_pending_store.ts';
import type {
  AIParser,
  Commentator,
  ImageInput,
  ImagePreparation,
  Ledger,
  ServiceOptions,
  ServiceResult,
} from './types.ts';

export class MoneyService {
  readonly #timeZone: string;
  readonly #clock: Clock;
  readonly #ledger: Ledger;
  readonly #ai: AIParser;
  readonly #comments?: Commentator;
  readonly #pending: ImagePendingStore;

  constructor(options: ServiceOptions) {
    this.#timeZone = options.timeZone ?? 'Asia/Ho_Chi_Minh';
    this.#clock = options.clock ? { now: options.clock } : systemClock;
    this.#ledger = options.ledger;
    this.#ai = options.ai;
    this.#comments = options.comments;
    this.#pending = new ImagePendingStore(this.#clock);
  }

  isSummaryIntent(text: string): boolean {
    return detectMonthlySummaryIntent(text);
  }

  async record(signal: AbortSignal, updateId: number, text: string): Promise<ServiceResult> {
    if (updateId <= 0) {
      throw new Error('telegram update ID is required');
    }
    text = text.trim();
    if (!text) return { text: usageText() };

    let transaction: Transaction;
    try {
      transaction = await this.#ai.parseTransaction(signal, text);
      validateTransaction(transaction);
    } catch {
      return { text: usageText() };
    }

    const now = this.#clock.now();
    transaction = {
      ...transaction,
      date: currentPlainDate(now, this.#timeZone),
      sourceUpdateId: updateId,
      originalMessage: text,
    };
    const result = await this.#ledger.appendTransactions(signal, updateId, [transaction]);
    if (result.status === 'duplicate') {
      return { text: duplicateText(transaction), parsed: true, usedAI: true, duplicate: true };
    }

    let response = successText(transaction, true);
    if (this.#comments) {
      try {
        const comment = (await this.#comments.confirmation(signal, transaction, true)).trim();
        if (comment) response += `\n${boundText(comment, 240)}`;
      } catch {
        // Commentary is best effort and must not turn a successful write into an error.
      }
    }
    return { text: response, parsed: true, usedAI: true };
  }

  async prepareImage(
    signal: AbortSignal,
    updateId: number,
    input: ImageInput,
  ): Promise<ImagePreparation> {
    if (updateId <= 0) throw new Error('telegram update ID is required');
    if (!input.mimeType.trim() || input.data.byteLength === 0) {
      throw new Error('image input is required');
    }

    let transaction: Transaction;
    try {
      transaction = await this.#ai.parseImageTransaction(
        signal,
        input.caption,
        input.mimeType,
        input.data,
      );
      validateTransaction(transaction);
    } catch (error) {
      throw new Error('image transaction could not be extracted', { cause: error });
    }

    const token = this.#pending.add(transaction, updateId);
    if (!token) throw new Error('pending image capacity reached');
    return { text: imagePreviewText(transaction), token };
  }

  async confirmImage(signal: AbortSignal, token: string): Promise<ServiceResult> {
    const pending = this.#pending.beginConfirmation(token);
    if (!pending) return { text: imageConfirmationUnavailableText() };

    const transaction: Transaction = {
      ...pending.transaction,
      date: currentPlainDate(this.#clock.now(), this.#timeZone),
      sourceUpdateId: pending.updateId,
    };
    try {
      const result = await this.#ledger.appendTransactions(signal, pending.updateId, [transaction]);
      if (result.status !== 'written' && result.status !== 'duplicate') {
        throw new Error(`unexpected append status: ${result.status}`);
      }
      this.#pending.complete(token);
      return result.status === 'duplicate'
        ? { text: duplicateText(transaction), parsed: true, duplicate: true }
        : { text: successText(transaction, false), parsed: true };
    } catch (error) {
      this.#pending.releaseConfirmation(token);
      throw error;
    }
  }

  cancelImage(token: string): ServiceResult {
    return this.#pending.cancel(token)
      ? { text: '✅ Đã hủy giao dịch từ ảnh.' }
      : { text: imageConfirmationUnavailableText() };
  }

  async summary(signal: AbortSignal, query: string): Promise<ServiceResult> {
    const period = parseMonthlySummaryPeriod(query, this.#clock.now(), this.#timeZone);
    if (!period) return { text: summaryUsageText() };
    const summary = await this.#ledger.monthlySummary(signal, period.year, period.month);
    let response = formatSummary(summary);
    if (this.#comments) {
      try {
        const comment = (await this.#comments.summaryCommentary(signal, summary)).trim();
        if (comment) response += `\n${boundText(comment, 320)}`;
      } catch {
        // Commentary is best effort.
      }
    }
    return { text: response };
  }

  get pendingImageCount(): number {
    return this.#pending.size;
  }
}

export type {
  AIParser,
  Commentator,
  ImageInput,
  ImagePreparation,
  Ledger,
  ServiceResult,
} from './types.ts';
