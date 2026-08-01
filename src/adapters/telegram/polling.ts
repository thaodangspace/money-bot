import { TelegramAPIError, type TelegramClient } from './client.ts';
import type { TelegramHandler } from './handler.ts';

export async function runPolling(
  signal: AbortSignal,
  client: Pick<TelegramClient, 'getUpdates'>,
  handler: Pick<TelegramHandler, 'handleUpdate'>,
  options: {
    updateTimeoutMs?: number;
    retryDelayMs?: number;
    pollTimeoutSeconds?: number;
    logger?: Pick<Console, 'warn'>;
  } = {},
): Promise<void> {
  const updateTimeoutMs = options.updateTimeoutMs ?? 30_000;
  const retryDelayMs = options.retryDelayMs ?? 3_000;
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? 30;
  const logger = options.logger ?? console;
  let offset = 0;
  while (!signal.aborted) {
    let updates;
    try {
      updates = await client.getUpdates(signal, offset, pollTimeoutSeconds);
    } catch (error) {
      if (signal.aborted) break;
      const delay = error instanceof TelegramAPIError && error.retryAfter
        ? error.retryAfter * 1_000
        : retryDelayMs;
      logger.warn('get Telegram updates failed', {
        error: redactTelegramToken(String(error)),
        retryAfterMs: delay,
      });
      await wait(signal, delay);
      continue;
    }
    for (const update of updates) {
      if (update.id < offset) continue;
      offset = update.id + 1;
      const timeout = AbortSignal.timeout(updateTimeoutMs);
      const updateSignal = AbortSignal.any([signal, timeout]);
      try {
        await handler.handleUpdate(updateSignal, update);
      } catch (error) {
        logger.warn('handle Telegram update failed', {
          updateId: update.id,
          error: redactTelegramToken(String(error)),
        });
      }
    }
  }
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
