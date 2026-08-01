import type { Callback, Message, Update } from './types.ts';

/** Converts a Telegram webhook payload without coupling it to the outbound API client. */
export function decodeTelegramUpdate(raw: unknown): Update | undefined {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.update_id) || typeof raw.update_id !== 'number') {
    return undefined;
  }
  const id = raw.update_id;
  const message = raw.message;
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
  const callback = raw.callback_query;
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
