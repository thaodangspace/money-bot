import { detectMonthlySummaryIntent } from '../parser/intent.ts';
import { parseMonthlySummaryPeriod } from '../parser/summary_period.ts';
import { currentPlainDate } from '../shared/calendar.ts';
import { type Clock, systemClock } from '../shared/runtime.ts';
import type { Transaction } from '../domain/transaction.ts';
import { validateTransaction } from '../domain/transaction.ts';
import {
  type ImageTransactionExtraction,
  MAX_IMAGE_TRANSACTIONS,
} from '../adapters/ai/image_types.ts';
import {
  boundText,
  duplicateBatchText,
  duplicateText,
  formatSummary,
  imageConfirmationUnavailableText,
  imagePreviewTextBatch,
  successBatchText,
  successText,
  summaryUsageText,
  usageText,
} from './format.ts';
import { InMemoryPendingImageStore, type PendingImageStore } from './image_pending_store.ts';
import { elapsedMs, errorFields, type Logger, nullLogger } from '../shared/logger.ts';
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
  readonly #pending: PendingImageStore;
  readonly #logger: Logger;
  #pendingCount = 0;

  constructor(options: ServiceOptions) {
    this.#timeZone = options.timeZone ?? 'Asia/Ho_Chi_Minh';
    this.#clock = options.clock ? { now: options.clock } : systemClock;
    this.#ledger = options.ledger;
    this.#ai = options.ai;
    this.#comments = options.comments;
    this.#pending = options.pending ?? new InMemoryPendingImageStore(this.#clock);
    this.#logger = options.logger ?? nullLogger;
  }

  isSummaryIntent(text: string): boolean {
    return detectMonthlySummaryIntent(text);
  }

  async record(signal: AbortSignal, updateId: number, text: string): Promise<ServiceResult> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.info('service.record.start', {
      from: 'TelegramHandler',
      to: 'MoneyService.record',
      updateId,
      textLength: text.length,
    });
    if (updateId <= 0) throw new Error('telegram update ID is required');
    text = text.trim();
    if (!text) return { text: usageText() };
    let transaction: Transaction;
    try {
      transaction = await this.#ai.parseTransaction(signal, text);
      validateTransaction(transaction);
    } catch (error) {
      logger.warn('service.record.parse_failed', {
        from: 'MoneyService.record',
        to: 'AIClient.parseTransaction',
        durationMs: elapsedMs(started),
        ...errorFields(error),
      });
      return { text: usageText() };
    }
    transaction = {
      ...transaction,
      date: currentPlainDate(this.#clock.now(), this.#timeZone),
      sourceUpdateId: updateId,
      originalMessage: text,
    };
    let result;
    try {
      result = await this.#ledger.appendTransactions(signal, updateId, [transaction]);
    } catch (error) {
      logger.error('service.record.ledger_failed', {
        from: 'MoneyService.record',
        to: 'SheetsRepository.appendTransactions',
        durationMs: elapsedMs(started),
        updateId,
        ...errorFields(error),
      });
      throw error;
    }
    if (result.status === 'duplicate') {
      logger.info('service.record.duplicate', {
        from: 'MoneyService.record',
        to: 'SheetsRepository.appendTransactions',
        durationMs: elapsedMs(started),
        updateId,
      });
      return { text: duplicateText(transaction), parsed: true, usedAI: true, duplicate: true };
    }
    let response = successText(transaction, true);
    if (this.#comments) {
      try {
        const comment = (await this.#comments.confirmation(signal, transaction, true)).trim();
        if (comment) response += `\n${boundText(comment, 240)}`;
      } catch (error) {
        logger.warn('service.record.commentary_failed', {
          from: 'MoneyService.record',
          to: 'AIClient.confirmation',
          ...errorFields(error),
        });
      }
    }
    logger.info('service.record.success', {
      from: 'MoneyService.record',
      to: 'TelegramHandler',
      durationMs: elapsedMs(started),
      updateId,
      usedAI: true,
    });
    return { text: response, parsed: true, usedAI: true };
  }

  async prepareImage(
    signal: AbortSignal,
    updateId: number,
    input: ImageInput,
  ): Promise<ImagePreparation> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.info('service.image.prepare.start', {
      from: 'TelegramHandler',
      to: 'MoneyService.prepareImage',
      updateId,
      bytes: input.data.byteLength,
      mimeType: input.mimeType,
    });
    if (updateId <= 0) throw new Error('telegram update ID is required');
    if (!input.mimeType.trim() || input.data.byteLength === 0) {
      throw new Error('image input is required');
    }
    let extraction: ImageTransactionExtraction;
    try {
      extraction = await this.#ai.parseImageTransactions(
        signal,
        input.caption,
        input.mimeType,
        input.data,
      );
      validateImageExtraction(extraction);
    } catch (error) {
      logger.warn('service.image.prepare.failed', {
        from: 'MoneyService.prepareImage',
        to: 'AIClient.parseImageTransactions',
        durationMs: elapsedMs(started),
        ...errorFields(error),
      });
      throw new Error('image transaction could not be extracted', { cause: error });
    }

    const today = currentPlainDate(this.#clock.now(), this.#timeZone);
    if (
      extraction.kind === 'transaction_list' &&
      extraction.transactions.some((transaction) => !transaction.date)
    ) {
      throw new Error('transaction list entry date is required');
    }
    const transactions = extraction.transactions.map((transaction) => ({
      ...transaction,
      date: transaction.date ?? today,
      sourceUpdateId: updateId,
      originalMessage: '',
    }));
    if (transactions.some((transaction) => transaction.date! > today)) {
      throw new Error('image transaction date is in the future');
    }
    const token = await this.#pending.add(signal, transactions, updateId);
    if (!token) throw new Error('pending image capacity reached');
    this.#pendingCount++;
    logger.info('service.image.prepare.success', {
      from: 'MoneyService.prepareImage',
      to: 'TelegramHandler',
      durationMs: elapsedMs(started),
      updateId,
      transactionCount: transactions.length,
    });
    return { text: imagePreviewTextBatch(transactions), token };
  }

  async confirmImage(signal: AbortSignal, token: string): Promise<ServiceResult> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.info('service.image.confirm.start', {
      from: 'TelegramHandler',
      to: 'MoneyService.confirmImage',
    });
    const pending = await this.#pending.getConfirmable(signal, token);
    if (!pending) {
      logger.info('service.image.confirm.unavailable', {
        from: 'MoneyService.confirmImage',
        to: 'TelegramHandler',
      });
      return { text: imageConfirmationUnavailableText() };
    }
    try {
      const result = await this.#ledger.appendTransactions(
        signal,
        pending.updateId,
        pending.transactions,
      );
      if (result.status !== 'written' && result.status !== 'duplicate') {
        throw new Error(`unexpected append status: ${result.status}`);
      }
      await this.#pending.complete(signal, token);
      this.#pendingCount = Math.max(0, this.#pendingCount - 1);
      logger.info('service.image.confirm.success', {
        from: 'MoneyService.confirmImage',
        to: 'TelegramHandler',
        durationMs: elapsedMs(started),
        status: result.status,
        transactionCount: pending.transactions.length,
      });
      return result.status === 'duplicate'
        ? { text: duplicateBatchText(pending.transactions), parsed: true, duplicate: true }
        : { text: successBatchText(pending.transactions), parsed: true };
    } catch (error) {
      this.#pending.release?.(token);
      // Failed writes intentionally leave the pending event active for retry.
      logger.error('service.image.confirm.failed', {
        from: 'MoneyService.confirmImage',
        to: 'SheetsRepository.appendTransactions',
        durationMs: elapsedMs(started),
        ...errorFields(error),
      });
      throw error;
    }
  }

  async cancelImage(signal: AbortSignal, token: string): Promise<ServiceResult> {
    const cancelled = await this.#pending.cancel(signal, token);
    if (cancelled) this.#pendingCount = Math.max(0, this.#pendingCount - 1);
    return cancelled
      ? { text: '✅ Đã hủy giao dịch từ ảnh.' }
      : { text: imageConfirmationUnavailableText() };
  }

  async summary(signal: AbortSignal, query: string): Promise<ServiceResult> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.info('service.summary.start', {
      from: 'TelegramHandler',
      to: 'MoneyService.summary',
      queryLength: query.length,
    });
    const period = parseMonthlySummaryPeriod(query, this.#clock.now(), this.#timeZone);
    if (!period) {
      logger.info('service.summary.invalid_period', {
        from: 'MoneyService.summary',
        to: 'TelegramHandler',
        durationMs: elapsedMs(started),
      });
      return { text: summaryUsageText() };
    }
    let summary;
    try {
      summary = await this.#ledger.monthlySummary(signal, period.year, period.month);
    } catch (error) {
      logger.error('service.summary.ledger_failed', {
        from: 'MoneyService.summary',
        to: 'SheetsRepository.monthlySummary',
        durationMs: elapsedMs(started),
        year: period.year,
        month: period.month,
        ...errorFields(error),
      });
      throw error;
    }
    let response = formatSummary(summary);
    if (this.#comments) {
      try {
        const comment = (await this.#comments.summaryCommentary(signal, summary)).trim();
        if (comment) response += `\n${boundText(comment, 320)}`;
      } catch (error) {
        logger.warn('service.summary.commentary_failed', {
          from: 'MoneyService.summary',
          to: 'AIClient.summaryCommentary',
          ...errorFields(error),
        });
      }
    }
    logger.info('service.summary.success', {
      from: 'MoneyService.summary',
      to: 'TelegramHandler',
      durationMs: elapsedMs(started),
      year: period.year,
      month: period.month,
      entryCount: summary.entryCount,
    });
    return { text: response };
  }

  get pendingImageCount(): number {
    return this.#pendingCount;
  }
}

function validateImageExtraction(extraction: ImageTransactionExtraction): void {
  if (
    !Number.isSafeInteger(extraction.detected) || extraction.detected < 1 ||
    extraction.detected > MAX_IMAGE_TRANSACTIONS || extraction.transactions.length < 1 ||
    extraction.transactions.length > MAX_IMAGE_TRANSACTIONS
  ) throw new Error('invalid image extraction count');
  if (
    extraction.kind !== 'transaction_list' &&
    (extraction.detected !== 1 || extraction.transactions.length !== 1)
  ) throw new Error('invalid single image extraction');
  if (
    extraction.kind === 'transaction_list' && extraction.detected !== extraction.transactions.length
  ) throw new Error('incomplete image transaction list');
  for (const transaction of extraction.transactions) validateTransaction(transaction);
}

export type {
  AIParser,
  Commentator,
  ImageInput,
  ImagePreparation,
  Ledger,
  ServiceResult,
} from './types.ts';
