import { decodeTelegramUpdate } from './update.ts';
import type { TelegramHandler } from './handler.ts';
import { type Logger, nullLogger } from '../../shared/logger.ts';

const MAX_BODY_BYTES = 1 << 20;
export interface WebhookOptions {
  path: string;
  secret: string;
  updateTimeoutMs?: number;
  logger?: Logger;
}

export function createWebhookHandler(
  handler: Pick<TelegramHandler, 'handleUpdate'>,
  options: WebhookOptions,
): (request: Request) => Promise<Response> {
  const path = options.path;
  const secret = options.secret;
  const timeoutMs = options.updateTimeoutMs ?? 30_000;
  const logger = options.logger ?? nullLogger;
  const common = { 'Cache-Control': 'no-store' };
  return async (request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      return new Response('ok\n', {
        status: 200,
        headers: { ...common, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    if (url.pathname !== path) return new Response('not found\n', { status: 404, headers: common });
    if (request.method !== 'POST') {
      return new Response('method not allowed\n', {
        status: 405,
        headers: { ...common, Allow: 'POST' },
      });
    }
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      return new Response('unauthorized\n', { status: 401, headers: common });
    }
    const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0]!.trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      return new Response('unsupported media type\n', { status: 415, headers: common });
    }
    const contentLength = request.headers.get('content-length');
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
    ) {
      return new Response('payload too large\n', { status: 413, headers: common });
    }
    let body: Uint8Array;
    try {
      body = await readLimitedBody(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLarge) {
        return new Response('payload too large\n', { status: 413, headers: common });
      }
      return new Response('bad request\n', { status: 400, headers: common });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return new Response('bad request\n', { status: 400, headers: common });
    }
    const update = decodeTelegramUpdate(raw);
    if (!update) return new Response('bad request\n', { status: 400, headers: common });
    if (!update.message && !update.callback) {
      return new Response('ok\n', { status: 200, headers: common });
    }
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout.signal]);
    try {
      await handler.handleUpdate(signal, update);
      return new Response('ok\n', { status: 200, headers: common });
    } catch (error) {
      logger.error('webhook.update.failed', {
        updateId: update.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        error: 'update processing failed',
      });
      return new Response('internal server error\n', { status: 500, headers: common });
    } finally {
      clearTimeout(timer);
    }
  };
}
class PayloadTooLarge extends Error {}
async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new PayloadTooLarge();
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
