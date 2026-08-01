import type { Transaction } from '../../domain/transaction.ts';
import type { AIParser, Commentator } from '../../service/types.ts';
import { parseTransactionJSON } from './validation.ts';
import { IMAGE_TRANSACTION_SYSTEM_PROMPT, TRANSACTION_SYSTEM_PROMPT } from './prompts.ts';

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CAPTION_RUNES = 500;

export class AIUnavailableError extends Error {
  override name = 'AIUnavailableError';
}

export interface AIClientOptions {
  provider?: string;
  apiKey?: string;
  model: string;
  imageModel?: string;
  baseURL: string;
  referer?: string;
  appName?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxImageBytes?: number;
  fetcher?: typeof fetch;
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
  readonly #imageModel: string;
  readonly #baseURL: string;
  readonly #referer?: string;
  readonly #appName?: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #maxImageBytes?: number;
  readonly #fetcher: typeof fetch;

  constructor(options: AIClientOptions) {
    if (!options.baseURL.trim()) throw new Error('AI base URL is required');
    if (!options.model.trim()) throw new Error('AI model is required');
    this.#provider = options.provider?.trim() || 'openai_compatible';
    this.#apiKey = options.apiKey?.trim() ?? '';
    this.#model = options.model.trim();
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
  }

  static openRouter(options: AIClientOptions): AIClient {
    if (!options.apiKey?.trim()) throw new AIUnavailableError('OpenRouter API key is required');
    return new AIClient({ ...options, provider: options.provider || 'openrouter' });
  }

  async parseTransaction(signal: AbortSignal, message: string): Promise<Transaction> {
    const content = await this.#chat(
      signal,
      [
        { role: 'system', content: TRANSACTION_SYSTEM_PROMPT },
        { role: 'user', content: `Message:\n${message}` },
      ],
      0.2,
      this.#model,
    );
    return parseTransactionJSON(content);
  }

  async parseImageTransaction(
    signal: AbortSignal,
    caption: string,
    mimeType: string,
    image: Uint8Array,
  ): Promise<Transaction> {
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
        { role: 'system', content: IMAGE_TRANSACTION_SYSTEM_PROMPT },
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
    return parseTransactionJSON(content);
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
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      const response = await this.#fetcher(`${this.#baseURL}/chat/completions`, {
        method: 'POST',
        signal: combined,
        headers: this.#headers(),
        body: JSON.stringify({ model, messages, temperature }),
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
      return content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`${this.#provider} request timed out or was cancelled`);
      }
      throw error;
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
