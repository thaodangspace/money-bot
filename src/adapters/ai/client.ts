import type { ConversationContext, ConversationIntent } from '../../domain/conversation.ts';
import type { Transaction } from '../../domain/transaction.ts';
import type { AIParser, Commentator } from '../../service/types.ts';
import {
  AIAmbiguousInputError,
  CONVERSATION_JSON_SCHEMA,
  InvalidAIOutputError,
  parseConversationIntentJSON,
  parseImageTransactionsJSON,
  parseTransactionJSON,
  TRANSACTION_JSON_SCHEMA,
} from './validation.ts';
import {
  CONVERSATION_REPAIR_SYSTEM_PROMPT,
  CONVERSATION_SYSTEM_PROMPT,
  IMAGE_TRANSACTIONS_SYSTEM_PROMPT,
  TRANSACTION_REPAIR_SYSTEM_PROMPT,
  TRANSACTION_SYSTEM_PROMPT,
} from './prompts.ts';
import type { ImageTransactionExtraction } from './image_types.ts';
import { elapsedMs, errorFields, type Logger, nullLogger } from '../../shared/logger.ts';

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CAPTION_RUNES = 500;
const TRANSACTION_SCHEMA_NAME = 'transaction';
const CONVERSATION_SCHEMA_NAME = 'conversation_intent';

export class AIUnavailableError extends Error {
  override name = 'AIUnavailableError';
}

/** JSON Schema, JSON object, or plain text response mode for text extraction. */
export type StructuredOutput = 'none' | 'json_object' | 'json_schema';

export interface AIClientOptions {
  provider?: string;
  apiKey?: string;
  model: string;
  routerModel?: string;
  imageModel?: string;
  baseURL: string;
  referer?: string;
  appName?: string;
  structuredOutput?: StructuredOutput;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxImageBytes?: number;
  fetcher?: typeof fetch;
  logger?: Logger;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string | ChatContentPart[];
}

interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export class AIClient implements AIParser, Commentator {
  readonly #provider: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #routerModel: string;
  readonly #imageModel: string;
  readonly #baseURL: string;
  readonly #referer?: string;
  readonly #appName?: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #maxImageBytes?: number;
  readonly #fetcher: typeof fetch;
  readonly #logger: Logger;
  readonly #transactionResponseFormat: unknown;
  readonly #conversationResponseFormat: unknown;

  constructor(options: AIClientOptions) {
    if (!options.baseURL.trim()) throw new Error('AI base URL is required');
    if (!options.model.trim()) throw new Error('AI model is required');
    this.#provider = options.provider?.trim() || 'openai_compatible';
    this.#apiKey = options.apiKey?.trim() ?? '';
    this.#model = options.model.trim();
    this.#routerModel = options.routerModel?.trim() || this.#model;
    this.#imageModel = options.imageModel?.trim() || this.#model;
    this.#baseURL = options.baseURL.replace(/\/+$/u, '');
    this.#referer = options.referer;
    this.#appName = options.appName;
    this.#timeoutMs = options.requestTimeoutMs && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes = options.maxResponseBytes && options.maxResponseBytes > 0
      ? options.maxResponseBytes
      : DEFAULT_MAX_RESPONSE_BYTES;
    this.#maxImageBytes = options.maxImageBytes;
    this.#fetcher = options.fetcher ?? fetch;
    this.#logger = options.logger ?? nullLogger;
    const outputMode = resolveStructuredOutput(options.structuredOutput, this.#provider);
    this.#transactionResponseFormat = responseFormatFor(
      outputMode,
      TRANSACTION_SCHEMA_NAME,
      TRANSACTION_JSON_SCHEMA,
    );
    this.#conversationResponseFormat = responseFormatFor(
      outputMode,
      CONVERSATION_SCHEMA_NAME,
      CONVERSATION_JSON_SCHEMA,
    );
  }

  static openRouter(options: AIClientOptions): AIClient {
    if (!options.apiKey?.trim()) throw new AIUnavailableError('OpenRouter API key is required');
    return new AIClient({ ...options, provider: options.provider || 'openrouter' });
  }

  async route(
    signal: AbortSignal,
    input: {
      message: string;
      now: string;
      timeZone: string;
      context?: ConversationContext;
    },
  ): Promise<ConversationIntent> {
    try {
      const content = await this.#chat(
        signal,
        [
          { role: 'system', content: CONVERSATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              message: input.message,
              now: input.now,
              timeZone: input.timeZone,
              context: input.context ?? null,
            }),
          },
        ],
        0,
        this.#routerModel,
        this.#conversationResponseFormat,
      );
      try {
        return parseConversationIntentJSON(content);
      } catch (error) {
        if (!(error instanceof InvalidAIOutputError)) throw error;
        return this.#repairRoute(signal, input);
      }
    } catch (error) {
      throw this.#unavailable(error);
    }
  }

  async #repairRoute(
    signal: AbortSignal,
    input: { message: string; now: string; timeZone: string; context?: ConversationContext },
  ): Promise<ConversationIntent> {
    try {
      const content = await this.#chat(
        signal,
        [
          { role: 'system', content: CONVERSATION_REPAIR_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(input) },
        ],
        0,
        this.#routerModel,
        this.#conversationResponseFormat,
      );
      return parseConversationIntentJSON(content);
    } catch (error) {
      if (error instanceof InvalidAIOutputError) throw error;
      throw this.#unavailable(error);
    }
  }

  async parseTransaction(signal: AbortSignal, message: string): Promise<Transaction> {
    try {
      const content = await this.#chat(
        signal,
        [
          { role: 'system', content: TRANSACTION_SYSTEM_PROMPT },
          { role: 'user', content: `Message:\n${message}` },
        ],
        0,
        this.#model,
        this.#transactionResponseFormat,
      );
      try {
        return parseTransactionJSON(content);
      } catch (error) {
        if (error instanceof AIAmbiguousInputError) throw error;
        if (!(error instanceof InvalidAIOutputError)) throw this.#unavailable(error);
        return this.#repairTransaction(signal, message);
      }
    } catch (error) {
      throw this.#unavailable(error);
    }
  }

  async #repairTransaction(signal: AbortSignal, message: string): Promise<Transaction> {
    try {
      const content = await this.#chat(
        signal,
        [
          { role: 'system', content: TRANSACTION_REPAIR_SYSTEM_PROMPT },
          { role: 'user', content: `Message:\n${message}` },
        ],
        0,
        this.#model,
        this.#transactionResponseFormat,
      );
      return parseTransactionJSON(content);
    } catch (error) {
      if (error instanceof AIAmbiguousInputError || error instanceof InvalidAIOutputError) {
        throw error;
      }
      throw this.#unavailable(error);
    }
  }

  #unavailable(error: unknown): unknown {
    if (
      error instanceof AIUnavailableError || error instanceof InvalidAIOutputError ||
      error instanceof AIAmbiguousInputError
    ) {
      return error;
    }
    return new AIUnavailableError(
      `${this.#provider} text parsing failed`,
      { cause: error },
    );
  }

  async parseImageTransactions(
    signal: AbortSignal,
    caption: string,
    mimeType: string,
    image: Uint8Array,
  ): Promise<ImageTransactionExtraction> {
    if (!isSupportedImageMime(mimeType) || image.byteLength === 0) {
      throw new Error('unsupported image input');
    }
    if (this.#maxImageBytes !== undefined && image.byteLength > this.#maxImageBytes) {
      throw new Error('image exceeds configured size limit');
    }
    const boundedCaption = truncateRunes(caption.trim(), MAX_CAPTION_RUNES);
    const dataURL = `data:${mimeType};base64,${encodeBase64(image)}`;
    const content = await this.#chat(
      signal,
      [
        { role: 'system', content: IMAGE_TRANSACTIONS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Caption (untrusted context; may be empty):\n${boundedCaption}` },
            { type: 'image_url', image_url: { url: dataURL } },
          ],
        },
      ],
      0,
      this.#imageModel,
    );
    return parseImageTransactionsJSON(content);
  }

  /** Backward-compatible helper for callers that only support single-image extraction. */
  async parseImageTransaction(
    signal: AbortSignal,
    caption: string,
    mimeType: string,
    image: Uint8Array,
  ): Promise<Transaction> {
    const extraction = await this.parseImageTransactions(signal, caption, mimeType, image);
    if (extraction.transactions.length !== 1) {
      throw new Error('image contains multiple transactions');
    }
    return extraction.transactions[0]!;
  }

  async confirmation(
    signal: AbortSignal,
    transaction: Transaction,
    usedAI: boolean,
  ): Promise<string> {
    const content = await this.#chat(
      signal,
      [
        {
          role: 'system',
          content:
            'Bạn là bot ghi chép chi tiêu vui vẻ. Trả lời tiếng Việt dưới 30 từ, không nêu lại số tiền nếu không cần.',
        },
        {
          role: 'user',
          content: `Đã lưu giao dịch type=${transaction.type} content=${
            JSON.stringify(transaction.category)
          } amount=${transaction.amount} usedAI=${usedAI}. Viết một câu xác nhận ngắn.`,
        },
      ],
      0.6,
      this.#model,
    );
    return truncateRunes(content.trim(), 240);
  }

  async summaryCommentary(
    signal: AbortSignal,
    summary: {
      year: number;
      month: number;
      totalExpenses: number;
      totalIncome: number;
      balance: number;
      entryCount: number;
    },
  ): Promise<string> {
    const content = await this.#chat(
      signal,
      [
        {
          role: 'system',
          content:
            'Bạn là bot tài chính vui vẻ. Viết một nhận xét tiếng Việt dưới 40 từ. Không thay đổi hoặc tính lại số liệu.',
        },
        {
          role: 'user',
          content: `Tháng ${
            String(summary.month).padStart(2, '0')
          }/${summary.year}: chi=${summary.totalExpenses}, thu=${summary.totalIncome}, cân bằng=${summary.balance}, số giao dịch=${summary.entryCount}. Viết nhận xét ngắn, không thay số.`,
        },
      ],
      0.5,
      this.#model,
    );
    return truncateRunes(content.trim(), 320);
  }

  async #chat(
    signal: AbortSignal,
    messages: ChatMessage[],
    temperature: number,
    model: string,
    responseFormat?: unknown,
  ): Promise<string> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.debug('external.call.start', {
      from: 'AIClient',
      to: `${this.#provider} chat completions`,
      provider: this.#provider,
      model,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      const body: Record<string, unknown> = { model, messages, temperature };
      if (responseFormat !== undefined) body.response_format = responseFormat;
      const response = await this.#fetcher(`${this.#baseURL}/chat/completions`, {
        method: 'POST',
        signal: combined,
        headers: this.#headers(),
        body: JSON.stringify(body),
      });
      const data = await readLimited(response, this.#maxResponseBytes);
      if (!response.ok) throw new Error(`${this.#provider} HTTP status ${response.status}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch (error) {
        throw new Error(`decode ${this.#provider} response: ${String(error)}`);
      }
      const content = chatContent(parsed);
      if (!content) throw new Error('AI response did not contain content');
      logger.info('external.call.success', {
        from: 'AIClient',
        to: `${this.#provider} chat completions`,
        provider: this.#provider,
        model,
        durationMs: elapsedMs(started),
      });
      return content;
    } catch (error) {
      const normalized = error instanceof DOMException && error.name === 'AbortError'
        ? new Error(`${this.#provider} request timed out or was cancelled`, { cause: error })
        : error;
      logger.error('external.call.failed', {
        from: 'AIClient',
        to: `${this.#provider} chat completions`,
        provider: this.#provider,
        model,
        durationMs: elapsedMs(started),
        ...errorFields(normalized),
      });
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }

  #headers(): HeadersInit {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;
    if (this.#referer) headers['HTTP-Referer'] = this.#referer;
    if (this.#appName) headers['X-Title'] = this.#appName;
    return headers;
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error('AI response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error('AI response too large');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function resolveStructuredOutput(
  configured: StructuredOutput | undefined,
  provider: string,
): StructuredOutput {
  if (configured === 'json_object' || configured === 'json_schema' || configured === 'none') {
    return configured;
  }
  return provider === 'lmstudio' ? 'none' : 'json_schema';
}

function responseFormatFor(mode: StructuredOutput, name: string, schema: unknown): unknown {
  if (mode === 'json_object') return { type: 'json_object' };
  if (mode === 'json_schema') {
    return { type: 'json_schema', json_schema: { name, strict: true, schema } };
  }
  return undefined;
}

function chatContent(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = choices[0] as { message?: unknown };
  if (typeof message.message !== 'object' || message.message === null) return undefined;
  const content = (message.message as { content?: unknown }).content;
  return typeof content === 'string' && content.trim() ? content : undefined;
}

function isSupportedImageMime(mimeType: string): boolean {
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp';
}

function truncateRunes(value: string, max: number): string {
  const runes = Array.from(value);
  return max <= 0 || runes.length <= max ? value : `${runes.slice(0, max - 1).join('')}…`;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
