import { createWebhookHandler } from './webhook.ts';

const update = JSON.stringify({
  update_id: 7,
  message: { from: { id: 1 }, chat: { id: 1 }, text: '/start' },
});
function request(
  method: string,
  path = '/telegram/webhook',
  body = update,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://example.test${path}`, {
    method,
    body: method === 'POST' ? body : undefined,
    headers,
  });
}
function handler(fail = false) {
  return {
    calls: 0,
    handleUpdate() {
      this.calls++;
      return fail ? Promise.reject(new Error('failed')) : Promise.resolve();
    },
  };
}

Deno.test('webhook authenticates, decodes, and waits for supported updates', async () => {
  const fake = handler();
  const serve = createWebhookHandler(fake, { path: '/telegram/webhook', secret: 'secret' });
  const response = await serve(
    request('POST', '/telegram/webhook', update, {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'secret',
    }),
  );
  if (response.status !== 200 || fake.calls !== 1) {
    throw new Error(`${response.status}/${fake.calls}`);
  }
});
Deno.test('webhook rejects before reading unauthorized bodies and validates requests', async () => {
  const serve = createWebhookHandler(handler(), { path: '/telegram/webhook', secret: 'secret' });
  const unauthorized = await serve(
    request('POST', '/telegram/webhook', update, { 'Content-Type': 'application/json' }),
  );
  if (unauthorized.status !== 401) throw new Error('unauthorized request accepted');
  if (
    (await serve(
      request('POST', '/telegram/webhook', update, {
        'Content-Type': 'text/plain',
        'X-Telegram-Bot-Api-Secret-Token': 'secret',
      }),
    )).status !== 415
  ) throw new Error('content type accepted');
  if (
    (await serve(
      request('POST', '/telegram/webhook', '{', {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'secret',
      }),
    )).status !== 400
  ) throw new Error('malformed JSON accepted');
});
Deno.test('webhook acknowledges unsupported updates and retries failed processing', async () => {
  const fake = handler();
  const serve = createWebhookHandler(fake, { path: '/telegram/webhook', secret: 'secret' });
  const unsupported = await serve(
    request('POST', '/telegram/webhook', JSON.stringify({ update_id: 8, edited_message: {} }), {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'secret',
    }),
  );
  if (unsupported.status !== 200 || fake.calls !== 0) {
    throw new Error('unsupported update was handled');
  }
  const failed = await createWebhookHandler(handler(true), {
    path: '/telegram/webhook',
    secret: 'secret',
  })(
    request('POST', '/telegram/webhook', update, {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'secret',
    }),
  );
  if (failed.status !== 500) throw new Error(`failure status ${failed.status}`);
});
Deno.test('webhook routes health and method/path errors', async () => {
  const serve = createWebhookHandler(handler(), { path: '/telegram/webhook', secret: 'secret' });
  if ((await serve(request('GET', '/healthz'))).headers.get('Cache-Control') !== 'no-store') {
    throw new Error('health cache policy missing');
  }
  const method = await serve(request('GET'));
  if (method.status !== 405 || method.headers.get('Allow') !== 'POST') {
    throw new Error('method route failed');
  }
  if ((await serve(request('GET', '/wrong'))).status !== 404) throw new Error('path route failed');
});
