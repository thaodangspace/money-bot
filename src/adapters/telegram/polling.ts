import { TelegramAPIError, type TelegramClient } from './client.ts';
import type { TelegramHandler } from './handler.ts';
import {
  bindLogContext,
  createLogger,
  createTraceId,
  elapsedMs,
  errorFields,
  type Logger,
} from '../../shared/logger.ts';

export async function runPolling(
  signal: AbortSignal,
  client: Pick<TelegramClient, 'getUpdates'>,
  handler: Pick<TelegramHandler, 'handleUpdate'>,
  options: {
    updateTimeoutMs?: number;
    retryDelayMs?: number;
    pollTimeoutSeconds?: number;
    logger?: Logger;
  } = {},
): Promise<void> {
  const updateTimeoutMs = options.updateTimeoutMs ?? 30_000;
  const retryDelayMs = options.retryDelayMs ?? 3_000;
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? 30;
  const logger = options.logger ?? createLogger('info');
  let offset = 0;
  while (!signal.aborted) {
    const started = performance.now();
    let updates;
    try {
      updates = await client.getUpdates(signal, offset, pollTimeoutSeconds);
      logger.debug('poll.receive.success', {
        from: 'telegram.polling',
        to: 'TelegramClient.getUpdates',
        durationMs: elapsedMs(started),
        updateCount: updates.length,
        offset,
      });
    } catch (error) {
      if (signal.aborted) break;
      const delay = error instanceof TelegramAPIError && error.retryAfter
        ? error.retryAfter * 1_000
        : retryDelayMs;
      logger.warn('poll.receive.failed', {
        from: 'telegram.polling',
        to: 'TelegramClient.getUpdates',
        durationMs: elapsedMs(started),
        ...errorFields(error),
        retryAfterMs: delay,
      });
      await wait(signal, delay);
      continue;
    }
    for (const update of updates) {
      if (update.id < offset) continue;
      offset = update.id + 1;
      const traceId = createTraceId();
      const timeout = AbortSignal.timeout(updateTimeoutMs);
      const updateSignal = AbortSignal.any([signal, timeout]);
      bindLogContext(updateSignal, { traceId, updateId: update.id });
      const updateStarted = performance.now();
      logger.info('update.handle.start', {
        from: 'telegram.polling',
        to: 'TelegramHandler.handleUpdate',
        updateId: update.id,
        traceId,
      });
      try {
        await handler.handleUpdate(updateSignal, update);
        logger.info('update.handle.success', {
          from: 'TelegramHandler.handleUpdate',
          to: 'telegram.polling',
          durationMs: elapsedMs(updateStarted),
          updateId: update.id,
        });
      } catch (error) {
        logger.error('update.handle.failed', {
          from: 'TelegramHandler.handleUpdate',
          to: 'telegram.polling',
          durationMs: elapsedMs(updateStarted),
          updateId: update.id,
          ...errorFields(error),
        });
      }
    }
  }
  logger.info('poll.stop', { reason: signal.aborted ? 'aborted' : 'completed', offset });
}

function wait(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function redactTelegramToken(message: string): string {
  return message.replace(/\/bot[^/\s]+/gu, '/bot[REDACTED]');
}
