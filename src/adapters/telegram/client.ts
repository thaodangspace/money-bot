import { isTelegramParseError, markdownV2 } from './format.ts';
import type { Callback, InlineKeyboard, Message, Messenger, Update } from './types.ts';

export interface TelegramClientOptions {
  token: string;
  apiBaseURL?: string;
  fetcher?: typeof fetch;
}

export class TelegramClient implements Messenger {
  readonly #token: string;
  readonly #apiBaseURL: string;
  readonly #fetcher: typeof fetch;

  constructor(options: TelegramClientOptions) {
    if (!options.token.trim()) throw new Error('telegram token is required');
    this.#token = options.token.trim();
    this.#apiBaseURL = (options.apiBaseURL ?? 'https://api.telegram.org').replace(/\/+$/u, '');
    this.#fetcher = options.fetcher ?? fetch;
  }

  async getUpdates(signal: AbortSignal, offset: number, timeoutSeconds = 30): Promise<Update[]> {
    const data = await this.#call(signal, 'getUpdates', { offset, timeout: timeoutSeconds });
    return Array.isArray(data.result)
      ? data.result.flatMap((raw) => {
        const converted = convertUpdate(raw);
        return converted ? [converted] : [];
      })
      : [];
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
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#apiBaseURL}/bot${this.#token}/${method}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
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
      throw error;
    }
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
function retryAfterSeconds(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const parameters = (value as { parameters?: unknown }).parameters;
  if (typeof parameters !== 'object' || parameters === null) return undefined;
  const retry = (parameters as { retry_after?: unknown }).retry_after;
  return typeof retry === 'number' && retry > 0 ? retry : undefined;
}

function convertUpdate(raw: unknown): Update | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const update = raw as Record<string, unknown>;
  if (typeof update.update_id !== 'number') return undefined;
  const id = update.update_id;
  const message = update.message;
  if (isRecord(message) && isRecord(message.from) && isRecord(message.chat)) {
    const result: Message = {
      chatId: number(message.chat.id),
      userId: number(message.from.id),
      text: string(message.text),
      caption: string(message.caption),
      isBot: message.from.is_bot === true,
      mediaGroupId: string(message.media_group_id) || undefined,
    };
    const photo = largestPhoto(message.photo);
    if (photo) {
      result.image = { fileId: string(photo.file_id), declaredSize: number(photo.file_size) };
    } else if (isRecord(message.document) && string(message.document.file_id)) {
      result.image = {
        fileId: string(message.document.file_id),
        declaredSize: number(message.document.file_size),
        declaredMime: string(message.document.mime_type) || undefined,
      };
    }
    return { id, message: result };
  }
  const callback = update.callback_query;
  if (
    isRecord(callback) && isRecord(callback.from) && isRecord(callback.message) &&
    isRecord(callback.message.chat)
  ) {
    const result: Callback = {
      id: string(callback.id),
      chatId: number(callback.message.chat.id),
      userId: number(callback.from.id),
      messageId: number(callback.message.message_id),
      data: string(callback.data),
    };
    return { id, callback: result };
  }
  // Keep unsupported update IDs so polling can advance Telegram's offset.
  return { id };
}
function largestPhoto(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).filter((photo) => string(photo.file_id)).sort((a, b) =>
    number(b.width) * number(b.height) - number(a.width) * number(a.height) ||
    number(b.file_size) - number(a.file_size)
  ).at(0);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function number(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
