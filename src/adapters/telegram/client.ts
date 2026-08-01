import { isTelegramParseError, markdownV2 } from './format.ts';
import type { InlineKeyboard, Messenger } from './types.ts';
import { elapsedMs, errorFields, type Logger, nullLogger } from '../../shared/logger.ts';

export interface TelegramClientOptions {
  token: string;
  apiBaseURL?: string;
  fetcher?: typeof fetch;
  logger?: Logger;
}

export class TelegramClient implements Messenger {
  readonly #token: string;
  readonly #apiBaseURL: string;
  readonly #fetcher: typeof fetch;
  readonly #logger: Logger;

  constructor(options: TelegramClientOptions) {
    if (!options.token.trim()) throw new Error('telegram token is required');
    this.#token = options.token.trim();
    this.#apiBaseURL = (options.apiBaseURL ?? 'https://api.telegram.org').replace(/\/+$/u, '');
    this.#fetcher = options.fetcher ?? fetch;
    this.#logger = options.logger ?? nullLogger;
  }

  async setWebhook(
    signal: AbortSignal,
    options: { url: string; secretToken: string; dropPendingUpdates?: boolean },
  ): Promise<void> {
    await this.#call(signal, 'setWebhook', {
      url: options.url,
      secret_token: options.secretToken,
      max_connections: 1,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: options.dropPendingUpdates === true,
    });
  }

  async getWebhookInfo(signal: AbortSignal): Promise<Record<string, unknown>> {
    const data = await this.#call(signal, 'getWebhookInfo', {});
    return typeof data.result === 'object' && data.result !== null
      ? data.result as Record<string, unknown>
      : {};
  }

  async deleteWebhook(signal: AbortSignal, dropPendingUpdates = false): Promise<void> {
    await this.#call(signal, 'deleteWebhook', { drop_pending_updates: dropPendingUpdates });
  }

  async sendMessage(
    signal: AbortSignal,
    chatId: number,
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<void> {
    const body = {
      chat_id: chatId,
      text: markdownV2(text),
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard
        ? {
          inline_keyboard: keyboard.map((row) =>
            row.map((button) => ({ text: button.text, callback_data: button.data }))
          ),
        }
        : undefined,
    };
    try {
      await this.#call(signal, 'sendMessage', body);
    } catch (error) {
      if (!isTelegramParseError(error)) throw error;
      await this.#call(signal, 'sendMessage', { ...body, text, parse_mode: undefined });
    }
  }

  async answerCallback(signal: AbortSignal, callbackId: string, text: string): Promise<void> {
    await this.#call(signal, 'answerCallbackQuery', { callback_query_id: callbackId, text });
  }

  async getFileDirectURL(signal: AbortSignal, fileId: string): Promise<string> {
    const data = await this.#call(signal, 'getFile', { file_id: fileId });
    const path = typeof (data.result as { file_path?: unknown } | undefined)?.file_path === 'string'
      ? (data.result as { file_path: string }).file_path
      : '';
    if (!path) throw new Error('Telegram file path was missing');
    return `${this.#apiBaseURL}/file/bot${this.#token}/${path}`;
  }

  async #call(
    signal: AbortSignal,
    method: string,
    body: Record<string, unknown>,
  ): Promise<{ result?: unknown }> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.debug('external.call.start', {
      from: 'TelegramClient',
      to: `Telegram API ${method}`,
      method,
    });
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#apiBaseURL}/bot${this.#token}/${method}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      logger.error('external.call.failed', {
        from: 'TelegramClient',
        to: `Telegram API ${method}`,
        method,
        durationMs: elapsedMs(started),
        ...errorFields(error),
      });
      throw new Error(`Telegram ${method} request failed`, { cause: error });
    }
    let data: unknown = {};
    try {
      data = await response.json();
    } catch { /* generic error below */ }
    if (!response.ok || !isTelegramOK(data)) {
      const retryAfter = retryAfterSeconds(data);
      const description = isRecord(data) && typeof data.description === 'string'
        ? data.description
        : '';
      const error = new TelegramAPIError(
        `Telegram ${method} failed${description ? `: ${description}` : ''}`,
        retryAfter,
      );
      logger.warn('external.call.failed', {
        from: 'TelegramClient',
        to: `Telegram API ${method}`,
        method,
        durationMs: elapsedMs(started),
        status: response.status,
        ...errorFields(error),
      });
      throw error;
    }
    logger.debug('external.call.success', {
      from: 'TelegramClient',
      to: `Telegram API ${method}`,
      method,
      durationMs: elapsedMs(started),
      status: response.status,
    });
    return data;
  }
}

export class TelegramAPIError extends Error {
  constructor(message: string, readonly retryAfter?: number) {
    super(message);
    this.name = 'TelegramAPIError';
  }
}

function isTelegramOK(value: unknown): value is { ok: true; result?: unknown } {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function retryAfterSeconds(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const parameters = (value as { parameters?: unknown }).parameters;
  if (typeof parameters !== 'object' || parameters === null) return undefined;
  const retry = (parameters as { retry_after?: unknown }).retry_after;
  return typeof retry === 'number' && retry > 0 ? retry : undefined;
}
