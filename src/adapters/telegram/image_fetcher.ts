import type { FetchedImage, ImageFetcher, ImageReference } from './types.ts';

export class ImageTooLargeError extends Error {
  override name = 'ImageTooLargeError';
}
export class UnsupportedImageError extends Error {
  override name = 'UnsupportedImageError';
}

export interface TelegramFileURLer {
  getFileDirectURL(signal: AbortSignal, fileId: string): Promise<string>;
}

export class TelegramImageFetcher implements ImageFetcher {
  readonly #urler: TelegramFileURLer;
  readonly #maxBytes: number;
  readonly #fetcher: typeof fetch;

  constructor(urler: TelegramFileURLer, maxBytes: number, fetcher: typeof fetch = fetch) {
    if (maxBytes <= 0) throw new Error('telegram image size limit must be positive');
    this.#urler = urler;
    this.#maxBytes = maxBytes;
    this.#fetcher = fetcher;
  }

  async fetchImage(signal: AbortSignal, reference: ImageReference): Promise<FetchedImage> {
    if (!reference.fileId) throw new Error('telegram image file ID is required');
    if ((reference.declaredSize ?? 0) > this.#maxBytes) {
      throw new ImageTooLargeError('telegram image exceeds size limit');
    }
    const url = await this.#urler.getFileDirectURL(signal, reference.fileId);
    const response = await this.#fetcher(url, { signal });
    if (!response.ok) {
      throw new Error(`telegram image download returned HTTP status ${response.status}`);
    }
    if (Number(response.headers.get('content-length')) > this.#maxBytes) {
      throw new ImageTooLargeError('telegram image exceeds size limit');
    }
    if (!response.body) throw new Error('telegram image response has no body');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > this.#maxBytes) {
          throw new ImageTooLargeError('telegram image exceeds size limit');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const mimeType = detectImageMime(data);
    if (
      !mimeType || (reference.declaredMime && !mimeCompatible(reference.declaredMime, mimeType))
    ) {
      throw new UnsupportedImageError('unsupported image content');
    }
    return { mimeType, data };
  }
}

export function detectImageMime(data: Uint8Array): string | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e &&
    data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  ) return 'image/png';
  if (
    data.length >= 12 && ascii(data.slice(0, 4)) === 'RIFF' && ascii(data.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return undefined;
}

function ascii(data: Uint8Array): string {
  return String.fromCharCode(...data);
}
function mimeCompatible(declared: string, detected: string): boolean {
  const normalized = declared.toLowerCase().split(';', 1)[0]!.trim();
  return normalized === detected;
}
