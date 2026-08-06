import type { ConversationContext } from '../../domain/conversation.ts';
import { TelegramAuthorizer } from './authz.ts';
import { chunkText, DEFAULT_MAX_MESSAGE_RUNES } from './format.ts';
import {
  CALLBACK_HELP,
  CALLBACK_MENU,
  CALLBACK_SUMMARY,
  helpText,
  quickMenuKeyboard,
  quickMenuText,
  startKeyboard,
  startText,
} from './menu.ts';
import { errorFields, type Logger, nullLogger } from '../../shared/logger.ts';
import type {
  Callback,
  ImageFetcher,
  Message,
  Messenger,
  MoneyServicePort,
  Update,
} from './types.ts';

const IMAGE_CONFIRM_PREFIX = 'img:ok:';
const IMAGE_CANCEL_PREFIX = 'img:no:';

export class TelegramHandler {
  readonly #messenger: Messenger;
  readonly #service: MoneyServicePort;
  readonly #authorizer: TelegramAuthorizer;
  readonly #imageFetcher?: ImageFetcher;
  readonly #maxOutputRunes: number;
  readonly #logger: Logger;
  readonly #contexts = new Map<number, ConversationContext>();

  constructor(
    options: {
      messenger: Messenger;
      service: MoneyServicePort;
      authorizer: TelegramAuthorizer;
      imageFetcher?: ImageFetcher;
      maxOutputRunes?: number;
      logger?: Logger;
    },
  ) {
    this.#messenger = options.messenger;
    this.#service = options.service;
    this.#authorizer = options.authorizer;
    this.#imageFetcher = options.imageFetcher;
    this.#maxOutputRunes = options.maxOutputRunes ?? DEFAULT_MAX_MESSAGE_RUNES;
    this.#logger = options.logger ?? nullLogger;
  }

  handleUpdate(signal: AbortSignal, update: Update): Promise<void> {
    const route = update.message ? 'message' : update.callback ? 'callback' : 'unsupported';
    this.#logger.forSignal(signal).debug('handler.route', {
      from: 'TelegramHandler.handleUpdate',
      to: `TelegramHandler.${route}`,
      updateId: update.id,
      route,
    });
    if (update.message) return this.#handleMessage(signal, update.id, update.message);
    if (update.callback) return this.#handleCallback(signal, update.callback);
    return Promise.resolve();
  }

  async #handleMessage(signal: AbortSignal, updateId: number, message: Message): Promise<void> {
    if (message.isBot) return;
    if (!this.#authorizer.isAllowedPrivateChat(message.userId, message.chatId)) {
      this.#logger.forSignal(signal).warn('handler.unauthorized', {
        from: 'TelegramHandler',
        to: 'Telegram API sendMessage',
      });
      await this.#messenger.sendMessage(signal, message.chatId, 'Không có quyền sử dụng bot này.');
      return;
    }
    if (message.image) return this.#handleImage(signal, updateId, message);
    const text = message.text.trim();
    if (!text) return;
    if (text.startsWith('/')) return this.#handleCommand(signal, message.chatId, text);
    if (this.#service.handleText) {
      const context = this.#activeContext(message.chatId);
      const result = await this.#service.handleText(signal, updateId, text, context);
      if (result.context) this.#contexts.set(message.chatId, result.context);
      await this.#sendChunks(signal, message.chatId, result.text);
      return;
    }
    if (this.#service.isSummaryIntent(text)) return this.#sendSummary(signal, message.chatId, text);
    return this.#sendRecord(signal, updateId, message.chatId, text);
  }

  async #handleImage(signal: AbortSignal, updateId: number, message: Message): Promise<void> {
    if (message.mediaGroupId) {
      return this.#sendChunks(
        signal,
        message.chatId,
        '⚠️ Hiện bot chỉ hỗ trợ một ảnh cho mỗi giao dịch. Vui lòng gửi ảnh riêng lẻ.',
      );
    }
    if (!this.#imageFetcher) {
      return this.#sendChunks(
        signal,
        message.chatId,
        '❌ Tính năng xử lý ảnh hiện chưa sẵn sàng. Vui lòng thử lại sau.',
      );
    }
    let image;
    try {
      image = await this.#imageFetcher.fetchImage(signal, message.image!);
    } catch (error) {
      this.#logger.forSignal(signal).error('handler.image.fetch.failed', {
        from: 'TelegramHandler',
        to: 'TelegramImageFetcher.fetchImage',
        updateId,
        ...errorFields(error),
      });
      await this.#sendChunks(
        signal,
        message.chatId,
        '❌ Không thể đọc ảnh. Vui lòng gửi JPEG, PNG hoặc WebP rõ nét, tối đa 5 MiB.',
      );
      throw error;
    }
    try {
      const prepared = await this.#service.prepareImage(signal, updateId, {
        caption: message.caption,
        mimeType: image.mimeType,
        data: image.data,
      });
      return this.#sendChunks(signal, message.chatId, prepared.text, imageKeyboard(prepared.token));
    } catch (error) {
      this.#logger.forSignal(signal).error('handler.image.prepare.failed', {
        from: 'TelegramHandler',
        to: 'MoneyService.prepareImage',
        updateId,
        ...errorFields(error),
      });
      await this.#sendChunks(
        signal,
        message.chatId,
        '❌ Mình chưa đọc được giao dịch rõ ràng từ ảnh. Vui lòng gửi ảnh đầy đủ, rõ nét hoặc thêm chú thích.',
      );
      throw error;
    }
  }

  async #handleCallback(signal: AbortSignal, callback: Callback): Promise<void> {
    if (!this.#authorizer.isAllowedPrivateChat(callback.userId, callback.chatId)) {
      await this.#messenger.answerCallback(signal, callback.id, 'Không có quyền');
      return;
    }
    const confirmed = callbackToken(callback.data, IMAGE_CONFIRM_PREFIX);
    if (confirmed) {
      await this.#messenger.answerCallback(signal, callback.id, 'Đang lưu');
      const result = await this.#service.confirmImage(signal, confirmed);
      return this.#sendChunks(signal, callback.chatId, result.text);
    }
    const cancelled = callbackToken(callback.data, IMAGE_CANCEL_PREFIX);
    if (cancelled) {
      await this.#messenger.answerCallback(signal, callback.id, 'Đã hủy');
      const result = await this.#service.cancelImage(signal, cancelled);
      return this.#sendChunks(signal, callback.chatId, result.text);
    }
    if (callback.data === CALLBACK_SUMMARY) {
      await this.#messenger.answerCallback(signal, callback.id, 'OK');
      return this.#sendSummary(signal, callback.chatId, '');
    }
    if (callback.data === CALLBACK_HELP) {
      await this.#messenger.answerCallback(signal, callback.id, 'OK');
      return this.#sendChunks(signal, callback.chatId, helpText());
    }
    if (callback.data === CALLBACK_MENU) {
      await this.#messenger.answerCallback(signal, callback.id, 'OK');
      return this.#sendChunks(signal, callback.chatId, quickMenuText(), quickMenuKeyboard());
    }
    await this.#messenger.answerCallback(signal, callback.id, 'Không rõ thao tác');
  }

  #handleCommand(signal: AbortSignal, chatId: number, text: string): Promise<void> {
    switch (commandName(text)) {
      case 'start':
        return this.#sendChunks(signal, chatId, startText(), startKeyboard());
      case 'menu':
        return this.#sendChunks(signal, chatId, quickMenuText(), quickMenuKeyboard());
      case 'summary':
        return this.#sendSummary(signal, chatId, commandArgs(text));
      case 'help':
        return this.#sendChunks(signal, chatId, helpText());
      default:
        return this.#sendChunks(signal, chatId, 'Không rõ lệnh. Dùng /help để xem hướng dẫn.');
    }
  }

  #activeContext(chatId: number): ConversationContext | undefined {
    const context = this.#contexts.get(chatId);
    if (!context) return undefined;
    if (Date.parse(context.expiresAt) <= Date.now()) {
      this.#contexts.delete(chatId);
      return undefined;
    }
    return context;
  }

  async #sendRecord(
    signal: AbortSignal,
    updateId: number,
    chatId: number,
    text: string,
  ): Promise<void> {
    const result = await this.#service.record(signal, updateId, text);
    await this.#sendChunks(signal, chatId, result.text);
  }

  async #sendSummary(signal: AbortSignal, chatId: number, query: string): Promise<void> {
    const result = await this.#service.summary(signal, query);
    await this.#sendChunks(signal, chatId, result.text);
  }

  async #sendChunks(
    signal: AbortSignal,
    chatId: number,
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<void> {
    const chunks = chunkText(text, this.#maxOutputRunes);
    const output = chunks.length ? chunks : [''];
    for (let index = 0; index < output.length; index++) {
      await this.#messenger.sendMessage(
        signal,
        chatId,
        output[index]!,
        index === output.length - 1 ? keyboard : undefined,
      );
    }
  }
}

type InlineKeyboard = Parameters<Messenger['sendMessage']>[3];
function imageKeyboard(token: string): InlineKeyboard | undefined {
  const confirm = `${IMAGE_CONFIRM_PREFIX}${token}`;
  const cancel = `${IMAGE_CANCEL_PREFIX}${token}`;
  if (
    !token || new TextEncoder().encode(confirm).byteLength > 64 ||
    new TextEncoder().encode(cancel).byteLength > 64
  ) return undefined;
  return [[{ text: 'Xác nhận', data: confirm }, { text: 'Hủy', data: cancel }]];
}
function callbackToken(data: string, prefix: string): string | undefined {
  if (!data.startsWith(prefix) || new TextEncoder().encode(data).byteLength > 64) return undefined;
  const token = data.slice(prefix.length);
  return token || undefined;
}
function commandName(text: string): string {
  const first = text.trim().split(/\s+/u)[0] ?? '';
  return first.replace(/^\//u, '').split('@', 1)[0]!.toLowerCase();
}
function commandArgs(text: string): string {
  return text.trim().split(/\s+/u).slice(1).join(' ');
}
