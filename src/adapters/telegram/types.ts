import type { ImageInput, ImagePreparation, ServiceResult } from '../../service/types.ts';

export interface Messenger {
  sendMessage(
    signal: AbortSignal,
    chatId: number,
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<void>;
  answerCallback(signal: AbortSignal, callbackId: string, text: string): Promise<void>;
}

export interface MoneyServicePort {
  record(signal: AbortSignal, updateId: number, text: string): Promise<ServiceResult>;
  prepareImage(signal: AbortSignal, updateId: number, input: ImageInput): Promise<ImagePreparation>;
  confirmImage(signal: AbortSignal, token: string): Promise<ServiceResult>;
  cancelImage(token: string): ServiceResult;
  summary(signal: AbortSignal, query: string): Promise<ServiceResult>;
  isSummaryIntent(text: string): boolean;
}

export type InlineKeyboard = Button[][];
export interface Button {
  text: string;
  data: string;
}

export interface Update {
  id: number;
  message?: Message;
  callback?: Callback;
}

export interface ImageReference {
  fileId: string;
  declaredSize?: number;
  declaredMime?: string;
}

export interface Message {
  chatId: number;
  userId: number;
  text: string;
  caption: string;
  image?: ImageReference;
  mediaGroupId?: string;
  isBot: boolean;
}

export interface Callback {
  id: string;
  chatId: number;
  userId: number;
  messageId: number;
  data: string;
}

export interface FetchedImage {
  mimeType: string;
  data: Uint8Array;
}

export interface ImageFetcher {
  fetchImage(signal: AbortSignal, reference: ImageReference): Promise<FetchedImage>;
}
