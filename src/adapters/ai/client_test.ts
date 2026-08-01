import { AIClient } from './client.ts';
import { InvalidAIOutputError, parseTransactionJSON } from './validation.ts';

const validModelResponse = JSON.stringify({
  choices: [{
    message: { content: '{"type":"expense","category":"Ăn tối","amount":150000,"note":"pizza"}' },
  }],
});

Deno.test('AI client builds text requests and provider headers', async () => {
  let requestURL = '';
  let requestInit: RequestInit | undefined;
  const client = new AIClient({
    provider: 'openrouter',
    apiKey: 'secret',
    model: 'model-x',
    baseURL: 'https://example.invalid/v1/',
    referer: 'https://example.test',
    appName: 'money-bot',
    fetcher: (input, init) => {
      requestURL = String(input);
      requestInit = init;
      return Promise.resolve(new Response(validModelResponse, { status: 200 }));
    },
  });
  const transaction = await client.parseTransaction(new AbortController().signal, 'ăn tối 150k');
  if (transaction.amount !== 150_000 || transaction.category !== 'Ăn tối') {
    throw new Error(JSON.stringify(transaction));
  }
  if (requestURL !== 'https://example.invalid/v1/chat/completions') throw new Error(requestURL);
  const headers = new Headers(requestInit?.headers);
  if (
    headers.get('Authorization') !== 'Bearer secret' ||
    headers.get('HTTP-Referer') !== 'https://example.test' || headers.get('X-Title') !== 'money-bot'
  ) {
    throw new Error('provider headers were not set');
  }
  const body = JSON.parse(String(requestInit?.body)) as { model: string; messages: unknown[] };
  if (body.model !== 'model-x' || body.messages.length !== 2) throw new Error(JSON.stringify(body));
});

Deno.test('AI client builds vision requests with a bounded caption and data URL', async () => {
  let requestInit: RequestInit | undefined;
  const client = new AIClient({
    model: 'text',
    imageModel: 'vision',
    baseURL: 'https://example.invalid',
    fetcher: (_input, init) => {
      requestInit = init;
      return Promise.resolve(new Response(validModelResponse));
    },
  });
  await client.parseImageTransaction(
    new AbortController().signal,
    '😀'.repeat(600),
    'image/jpeg',
    new Uint8Array([0xff, 0xd8, 0xff]),
  );
  const body = JSON.parse(String(requestInit?.body)) as {
    model: string;
    messages: Array<{ content: unknown }>;
  };
  if (body.model !== 'vision') throw new Error(body.model);
  const parts = body.messages[1]?.content as Array<
    { type: string; text?: string; image_url?: { url: string } }
  >;
  const boundedCaption = (parts[0]?.text ?? '').split('\n').slice(1).join('\n');
  if (parts[0]?.type !== 'text' || Array.from(boundedCaption).length !== 500) {
    throw new Error('caption was not bounded');
  }
  if (parts[1]?.image_url?.url !== 'data:image/jpeg;base64,/9j/') {
    throw new Error(String(parts[1]?.image_url?.url));
  }
});

Deno.test('AI JSON validation accepts only a strict transaction object', () => {
  const transaction = parseTransactionJSON(
    '{"type":"income","category":" lương  ","amount":2000000,"note":" tháng 7 "}',
  );
  if (
    transaction.type !== 'income' || transaction.category !== 'lương' ||
    transaction.note !== 'tháng 7'
  ) throw new Error(JSON.stringify(transaction));
  for (
    const content of [
      '```json\n{"type":"expense","category":"food","amount":1,"note":""}\n```',
      '{"type":"expense","category":"food","amount":1,"note":""} trailing',
      '{"type":"expense","category":"food","amount":1,"note":"","extra":true}',
      '{"type":"expense","category":"food","amount":1.5,"note":""}',
      '{"type":"expense","category":"food","amount":9007199254740992,"note":""}',
      '{"type":"expense","type":"income","category":"food","amount":1,"note":""}',
      '{"error":"unknown"}',
    ]
  ) throws(() => parseTransactionJSON(content));
});

Deno.test('AI client enforces response size and cancellation without leaking secrets', async () => {
  const client = new AIClient({
    apiKey: 'do-not-leak',
    model: 'model',
    baseURL: 'https://example.invalid',
    maxResponseBytes: 4,
    fetcher: () => Promise.resolve(new Response('12345')),
  });
  let tooLarge = false;
  try {
    await client.parseTransaction(new AbortController().signal, 'message');
  } catch (error) {
    tooLarge = String(error).includes('too large') && !String(error).includes('do-not-leak');
  }
  if (!tooLarge) throw new Error('oversized response was accepted or leaked a secret');

  const controller = new AbortController();
  controller.abort();
  const cancelled = new AIClient({
    model: 'model',
    baseURL: 'https://example.invalid',
    fetcher: (_input, init) => {
      const requestSignal = (init as RequestInit | undefined)?.signal;
      if (requestSignal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
      return Promise.resolve(new Response(validModelResponse));
    },
  });
  let aborted = false;
  try {
    await cancelled.parseTransaction(controller.signal, 'message');
  } catch {
    aborted = true;
  }
  if (!aborted) throw new Error('cancelled request was accepted');
});

function throws(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof InvalidAIOutputError)) throw new Error(`wrong error: ${String(error)}`);
    return;
  }
  throw new Error('expected validation failure');
}
