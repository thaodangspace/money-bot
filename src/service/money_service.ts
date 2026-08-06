import {
  type ConversationContext,
  type ConversationIntent,
  validateConversationIntent,
} from '../domain/conversation.ts';
import { detectMonthlySummaryIntent } from '../parser/intent.ts';
import { parseMonthlySummaryPeriod } from '../parser/summary_period.ts';
import { parseTransaction, TransactionNotRecognizedError } from '../parser/transaction.ts';
import { currentPlainDate } from '../shared/calendar.ts';
import { type Clock, systemClock } from '../shared/runtime.ts';
import type { Transaction } from '../domain/transaction.ts';
import { validateTransaction } from '../domain/transaction.ts';
import {
  type ImageTransactionExtraction,
  MAX_IMAGE_TRANSACTIONS,
} from '../adapters/ai/image_types.ts';
import {
  aiInvalidResponseText,
  aiUnavailableText,
  aiUnrecognizedText,
  boundText,
  clarifyText,
  duplicateBatchText,
  duplicateText,
  formatSummary,
  greetingText,
  imageConfirmationUnavailableText,
  imagePreviewTextBatch,
  successBatchText,
  successText,
  summaryUsageText,
  unsupportedText,
  usageText,
} from './format.ts';
import { InMemoryPendingImageStore, type PendingImageStore } from './image_pending_store.ts';
import { elapsedMs, errorFields, type Logger, nullLogger } from '../shared/logger.ts';
import { AIUnavailableError } from '../adapters/ai/client.ts';
import { AIAmbiguousInputError, InvalidAIOutputError } from '../adapters/ai/validation.ts';
import type {
  AIParser,
  Commentator,
  ConversationRouter,
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
  readonly #router?: ConversationRouter;
  readonly #comments?: Commentator;
  readonly #pending: PendingImageStore;
  readonly #logger: Logger;
  #pendingCount = 0;

  constructor(options: ServiceOptions) {
    this.#timeZone = options.timeZone ?? 'Asia/Ho_Chi_Minh';
    this.#clock = options.clock ? { now: options.clock } : systemClock;
    this.#ledger = options.ledger;
    this.#ai = options.ai;
    this.#router = options.router;
    this.#comments = options.comments;
    this.#pending = options.pending ?? new InMemoryPendingImageStore(this.#clock);
    this.#logger = options.logger ?? nullLogger;
  }

  isSummaryIntent(text: string): boolean {
    return detectMonthlySummaryIntent(text);
  }

  async handleText(
    signal: AbortSignal,
    updateId: number,
    text: string,
    context?: ConversationContext,
  ): Promise<ServiceResult> {
    if (updateId <= 0) throw new Error('telegram update ID is required');
    const message = text.trim();
    if (!message) return { text: usageText(), context };
    if (!this.#router) {
      return detectMonthlySummaryIntent(message)
        ? this.summary(signal, message)
        : this.record(signal, updateId, message);
    }
    const started = performance.now();
    let intent: ConversationIntent;
    try {
      intent = await this.#router.route(signal, {
        message,
        now: this.#clock.now().toISOString(),
        timeZone: this.#timeZone,
        context,
      });
      validateConversationIntent(intent);
    } catch (error) {
      this.#logger.forSignal(signal).warn('service.route.failed', {
        from: 'MoneyService.handleText',
        to: 'ConversationRouter.route',
        durationMs: elapsedMs(started),
        ...errorFields(error),
      });
      const fallback = await this.#deterministicFallback(signal, updateId, message);
      if (fallback) return fallback;
      return {
        text: error instanceof InvalidAIOutputError ? aiInvalidResponseText() : aiUnavailableText(),
        context,
      };
    }
    this.#logger.forSignal(signal).info('service.route.success', {
      from: 'MoneyService.handleText',
      to: 'MoneyService.dispatchIntent',
      durationMs: elapsedMs(started),
      kind: intent.kind,
    });
    switch (intent.kind) {
      case 'record_transaction': {
        const result = await this.#recordRouted(signal, updateId, message, intent.transaction);
        return { ...result, context: routedContext(this.#clock.now(), intent) };
      }
      case 'monthly_summary': {
        const query = summaryQuery(intent.period);
        const result = await this.summary(signal, query);
        const period = resolveConversationPeriod(intent.period, this.#clock.now(), this.#timeZone);
        return {
          ...result,
          context: {
            lastIntent: 'monthly_summary',
            lastSummaryPeriod: period,
            expiresAt: new Date(this.#clock.now().getTime() + CONTEXT_TTL_MS).toISOString(),
          },
        };
      }
      case 'help':
        return {
          text:
            'Bạn có thể ghi thu/chi bằng tiếng Việt, hỏi báo cáo tháng, gửi ảnh hóa đơn để xác nhận, hoặc hỏi “bạn làm được gì?”.',
          context,
        };
      case 'menu':
        return { text: 'Bạn muốn ghi giao dịch, xem báo cáo tháng, hay xem hướng dẫn?', context };
      case 'greeting':
        return { text: greetingText(), context };
      case 'clarify': {
        const fallback = await this.#deterministicFallback(signal, updateId, message);
        if (fallback) return fallback;
        // The intent does not identify what is missing, so never retain a stale
        // transaction/summary clarification across turns.
        return { text: clarifyText(intent.question) };
      }
      case 'unsupported':
        return { text: unsupportedText(intent.reply), context };
      default:
        return assertNever(intent);
    }
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
    let usedAI = false;
    try {
      try {
        transaction = parseTransaction(text);
      } catch (error) {
        if (!(error instanceof TransactionNotRecognizedError)) throw error;
        usedAI = true;
        try {
          transaction = await this.#ai.parseTransaction(signal, text);
        } catch (aiError) {
          throw classifyAIError(aiError);
        }
      }
      validateTransaction(transaction);
    } catch (error) {
      const failureStage = failureDescription(error, usedAI);
      logger.warn('service.record.parse_failed', {
        from: 'MoneyService.record',
        to: usedAI ? 'AIClient.parseTransaction' : 'DeterministicParser.parseTransaction',
        durationMs: elapsedMs(started),
        strategy: usedAI ? 'ai' : 'deterministic',
        failureStage,
        ...errorFields(error),
      });
      return { text: failureText(error, usedAI), parsed: false };
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
      return { text: duplicateText(transaction), parsed: true, usedAI, duplicate: true };
    }
    let response = successText(transaction, usedAI);
    if (this.#comments) {
      try {
        const comment = (await this.#comments.confirmation(signal, transaction, usedAI)).trim();
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
      usedAI,
    });
    return { text: response, parsed: true, usedAI };
  }

  #deterministicFallback(
    signal: AbortSignal,
    updateId: number,
    message: string,
  ): Promise<ServiceResult | undefined> {
    if (detectMonthlySummaryIntent(message)) return this.summary(signal, message);
    let transaction: Transaction;
    try {
      transaction = parseTransaction(message);
    } catch {
      return Promise.resolve(undefined);
    }
    this.#logger.forSignal(signal).info('service.route.deterministic_fallback', {
      from: 'MoneyService.handleText',
      to: 'DeterministicParser.parseTransaction',
      updateId,
    });
    return this.#recordRouted(signal, updateId, message, transaction, false);
  }

  async #recordRouted(
    signal: AbortSignal,
    updateId: number,
    message: string,
    routed: { type: 'expense' | 'income'; category: string; amount: number; note?: string },
    usedAI = true,
  ): Promise<ServiceResult> {
    const transaction: Transaction = {
      type: routed.type,
      category: routed.category,
      amount: routed.amount,
      note: routed.note,
      date: currentPlainDate(this.#clock.now(), this.#timeZone),
      sourceUpdateId: updateId,
      originalMessage: message,
    };
    validateTransaction(transaction);
    const result = await this.#ledger.appendTransactions(signal, updateId, [transaction]);
    if (result.status === 'duplicate') {
      return { text: duplicateText(transaction), parsed: true, duplicate: true, usedAI };
    }
    // Keep the routed write response deterministic. An optional commentary call
    // would add another LLM round-trip to the webhook's time budget.
    return { text: successText(transaction, usedAI), parsed: true, usedAI };
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

const CONTEXT_TTL_MS = 20 * 60 * 1000;

function summaryQuery(period: { year: number; month: number } | { relative: string }): string {
  if ('relative' in period) {
    return period.relative === 'previous_month' ? 'tháng trước' : 'tháng này';
  }
  return `${String(period.month).padStart(2, '0')}/${period.year}`;
}

function resolveConversationPeriod(
  period: { year: number; month: number } | { relative: string },
  now: Date,
  timeZone: string,
): { year: number; month: number } {
  if ('year' in period) return period;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric' })
    .formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (period.relative === 'current_month') return { year, month };
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function routedContext(now: Date, intent: ConversationIntent): ConversationContext {
  return {
    lastIntent: intent.kind === 'record_transaction' ? 'record_transaction' : undefined,
    expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS).toISOString(),
  };
}

function assertNever(value: never): never {
  throw new Error(`unsupported conversation intent: ${String(value)}`);
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

function classifyAIError(error: unknown): unknown {
  if (
    error instanceof AIUnavailableError || error instanceof AIAmbiguousInputError ||
    error instanceof InvalidAIOutputError
  ) {
    return error;
  }
  return new AIUnavailableError('AI text parsing failed', { cause: error });
}

function failureDescription(error: unknown, usedAI: boolean): string {
  if (!usedAI) return 'deterministic_invalid';
  if (error instanceof AIAmbiguousInputError) return 'ai_ambiguous';
  if (error instanceof InvalidAIOutputError) return 'ai_invalid_response';
  if (error instanceof AIUnavailableError) return 'ai_unavailable';
  return 'ai_unknown';
}

function failureText(error: unknown, usedAI: boolean): string {
  if (!usedAI) return usageText();
  if (error instanceof AIUnavailableError) return aiUnavailableText();
  if (error instanceof AIAmbiguousInputError) return aiUnrecognizedText();
  if (error instanceof InvalidAIOutputError) return aiInvalidResponseText();
  return aiUnavailableText();
}

export type {
  AIParser,
  Commentator,
  ImageInput,
  ImagePreparation,
  Ledger,
  ServiceResult,
} from './types.ts';
