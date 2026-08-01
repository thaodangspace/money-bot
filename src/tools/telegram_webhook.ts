import { TelegramClient } from '../adapters/telegram/client.ts';

const path = Deno.env.get('TELEGRAM_WEBHOOK_PATH') || '/telegram/webhook';
const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || '';
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
const client = new TelegramClient({ token });
const command = Deno.args[0] || 'info';
const drop = Deno.args.includes('--drop-pending-updates');
const signal = new AbortController().signal;

if (command === 'set') {
  const raw = Deno.env.get('TELEGRAM_WEBHOOK_URL') || '';
  const url = validateURL(raw);
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/u.test(secret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET is invalid');
  }
  await client.setWebhook(signal, { url, secretToken: secret, dropPendingUpdates: drop });
  printInfo(await client.getWebhookInfo(signal));
} else if (command === 'info') {
  printInfo(await client.getWebhookInfo(signal));
} else if (command === 'delete') {
  await client.deleteWebhook(signal, drop);
  console.log(
    drop
      ? 'Webhook deleted; pending updates dropped.'
      : 'Webhook deleted; pending updates preserved.',
  );
} else throw new Error('usage: set|info|delete [--drop-pending-updates]');

function validateURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TELEGRAM_WEBHOOK_URL must be an HTTPS URL');
  }
  if (
    url.protocol !== 'https:' || url.username || url.password || url.hash || url.pathname !== path
  ) {
    throw new Error(
      'TELEGRAM_WEBHOOK_URL must be HTTPS, credential-free, and point to TELEGRAM_WEBHOOK_PATH',
    );
  }
  return url.toString();
}
function printInfo(info: Record<string, unknown>): void {
  const output: Record<string, unknown> = {
    url: typeof info.url === 'string' ? info.url : '',
    pending_update_count: typeof info.pending_update_count === 'number'
      ? info.pending_update_count
      : 0,
    max_connections: typeof info.max_connections === 'number' ? info.max_connections : undefined,
    allowed_updates: Array.isArray(info.allowed_updates) ? info.allowed_updates : undefined,
  };
  if (typeof info.last_error_date === 'number') output.last_error_date = info.last_error_date;
  if (typeof info.last_error_message === 'string') {
    output.last_error_message = info.last_error_message;
  }
  console.log(JSON.stringify(output, null, 2));
}
