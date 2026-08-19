import { TelegramAuthorizer } from './authz.ts';
import { TelegramClient } from './client.ts';
import { chunkText, markdownV2 } from './format.ts';
import { detectImageMime, TelegramImageFetcher } from './image_fetcher.ts';
import { renderReportMarkdown } from './report_markdown.ts';

Deno.test('Telegram authorization requires the allowed private user and chat', () => {
  const authorizer = new TelegramAuthorizer([42]);
  if (
    !authorizer.isAllowedPrivateChat(42, 42) || authorizer.isAllowedPrivateChat(42, -42) ||
    authorizer.isAllowedPrivateChat(7, 42)
  ) throw new Error('authorization mismatch');
});

Deno.test('Telegram authorization supports multiple allowed users', () => {
  const authorizer = new TelegramAuthorizer([42, 99, 777]);
  if (
    !authorizer.isAllowedPrivateChat(42, 42) ||
    !authorizer.isAllowedPrivateChat(99, 99) ||
    !authorizer.isAllowedPrivateChat(777, 777) ||
    authorizer.isAllowedPrivateChat(1, 1) ||
    authorizer.isAllowedPrivateChat(42, 99)
  ) throw new Error('multi-user authorization mismatch');
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

Deno.test('report Markdown preserves every row and protects table cells', () => {
  const markdown = renderReportMarkdown({
    text: 'report',
    year: 2026,
    month: 8,
    summary: {
      year: 2026,
      month: 8,
      totalExpenses: 150000,
      totalIncome: 0,
      totalInvest: 50000,
      totalSaving: 25000,
      balance: -125000,
      entryCount: 1,
    },
    rows: [{ date: '18/08/2026', type: 'expense', content: 'ăn | tối\nnhà', amount: 150000 }],
  });
  if (
    !markdown.includes('Total investments: 50000 VND') ||
    !markdown.includes('Total savings: 25000 VND') || !markdown.includes('Money report')
  ) throw new Error('report setup failed');
  if (!markdown.includes('ăn \\| tối nhà')) throw new Error(markdown);
  if (!markdown.includes('| 1 | 18/08/2026 | expense |')) throw new Error(markdown);

  const backslashPipe = renderReportMarkdown({
    text: 'report',
    year: 2026,
    month: 8,
    summary: {
      year: 2026,
      month: 8,
      totalExpenses: 1,
      totalIncome: 0,
      totalInvest: 0,
      totalSaving: 0,
      balance: -1,
      entryCount: 1,
    },
    rows: [{ date: '18/08/2026', type: 'expense', content: String.raw`foo\|bar`, amount: 1 }],
  });
  if (!backslashPipe.includes(String.raw`foo\\\|bar`)) throw new Error(backslashPipe);
});

Deno.test('zero-transaction reports still include metadata and a table', () => {
  const markdown = renderReportMarkdown({
    text: 'report',
    year: 2026,
    month: 9,
    summary: {
      year: 2026,
      month: 9,
      totalExpenses: 0,
      totalIncome: 0,
      totalInvest: 0,
      totalSaving: 0,
      balance: 0,
      entryCount: 0,
    },
    rows: [],
  });
  if (!markdown.includes('No transactions.') || !markdown.includes('| # | Date | Type |')) {
    throw new Error(markdown);
  }
});

Deno.test('Telegram documents use multipart sendDocument with UTF-8 bytes', async () => {
  let requestURL = '';
  let requestInit: RequestInit | undefined;
  const client = new TelegramClient({
    token: 'token',
    apiBaseURL: 'https://telegram.test',
    fetcher: (input, init) => {
      requestURL = String(input);
      requestInit = init;
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    },
  });
  const bytes = new TextEncoder().encode('# Báo cáo');
  await client.sendDocument(new AbortController().signal, 42, {
    filename: 'money-report-2026-08.md',
    mimeType: 'text/markdown; charset=utf-8',
    data: bytes,
  });
  if (!requestURL.endsWith('/sendDocument') || !(requestInit?.body instanceof FormData)) {
    throw new Error('document was not sent as multipart');
  }
  const file = requestInit.body.get('document');
  if (
    !(file instanceof File) || file.name !== 'money-report-2026-08.md' ||
    file.type !== 'text/markdown; charset=utf-8'
  ) {
    throw new Error('document metadata mismatch');
  }
  if (new TextDecoder().decode(await file.arrayBuffer()) !== '# Báo cáo') {
    throw new Error('document bytes mismatch');
  }
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
