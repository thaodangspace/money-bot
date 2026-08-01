import { TelegramAuthorizer } from './authz.ts';
import { TelegramClient } from './client.ts';
import { chunkText, markdownV2 } from './format.ts';
import { detectImageMime, TelegramImageFetcher } from './image_fetcher.ts';

Deno.test('Telegram authorization requires the allowed private user and chat', () => {
  const authorizer = new TelegramAuthorizer(42);
  if (
    !authorizer.isAllowedPrivateChat(42, 42) || authorizer.isAllowedPrivateChat(42, -42) ||
    authorizer.isAllowedPrivateChat(7, 42)
  ) throw new Error('authorization mismatch');
});

Deno.test('Telegram Markdown escaping and rune chunking are safe', () => {
  if (
    markdownV2('_*[]()~`>#+-=|{}.!\\') !==
      '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\'
  ) throw new Error('markdown mismatch');
  const chunks = chunkText('😀'.repeat(5), 2);
  if (chunks.length !== 3 || chunks[0] !== '😀😀' || chunks[2] !== '😀') {
    throw new Error(JSON.stringify(chunks));
  }
});

Deno.test('Telegram polling preserves unsupported update IDs for offset advancement', async () => {
  const client = new TelegramClient({
    token: '123:test',
    apiBaseURL: 'https://example.invalid',
    fetcher: () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: [{ update_id: 17, edited_message: {} }] })),
      ),
  });
  const updates = await client.getUpdates(new AbortController().signal, 0);
  if (
    updates.length !== 1 || updates[0]?.id !== 17 || updates[0]?.message || updates[0]?.callback
  ) throw new Error(JSON.stringify(updates));
});

Deno.test('image MIME detection and streaming size limits are enforced', async () => {
  if (detectImageMime(new Uint8Array([0xff, 0xd8, 0xff])) !== 'image/jpeg') {
    throw new Error('jpeg not detected');
  }
  if (detectImageMime(new TextEncoder().encode('not image'))) {
    throw new Error('invalid image detected');
  }
  const fetcher = new TelegramImageFetcher(
    { getFileDirectURL: () => Promise.resolve('https://example.invalid/file') },
    8,
    () =>
      Promise.resolve(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      ),
  );
  const image = await fetcher.fetchImage(new AbortController().signal, { fileId: 'file' });
  if (image.mimeType !== 'image/png' || image.data.length !== 8) {
    throw new Error('image fetch failed');
  }
});
