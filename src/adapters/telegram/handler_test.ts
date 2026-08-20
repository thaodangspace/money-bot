import { TelegramAuthorizer } from './authz.ts';
import { TelegramHandler } from './handler.ts';
import type {
  DocumentAttachment,
  ImageFetcher,
  InlineKeyboard,
  Messenger,
  MoneyServicePort,
} from './types.ts';
import type { RecordOptions, ReportResponse, ServiceResult } from '../../service/types.ts';

class FakeMessenger implements Messenger {
  messages: string[] = [];
  documents: DocumentAttachment[] = [];
  failDocument = false;

  sendMessage(_signal: AbortSignal, _chatId: number, text: string, _keyboard?: InlineKeyboard) {
    this.messages.push(text);
    return Promise.resolve();
  }
  sendDocument(
    _signal: AbortSignal,
    _chatId: number,
    document: DocumentAttachment,
  ) {
    if (this.failDocument) return Promise.reject(new Error('upload failed'));
    this.documents.push(document);
    return Promise.resolve();
  }
  answerCallback() {
    return Promise.resolve();
  }
}

class FakeService implements MoneyServicePort {
  reportCalls = 0;
  financialSummaryCalls = 0;
  reportQueries: string[] = [];
  recordCalls: Array<{ updateId: number; text: string; options?: RecordOptions }> = [];
  summaryIntent = false;
  imageError?: Error;
  report(_signal: AbortSignal, query: string): Promise<ReportResponse> {
    this.reportCalls++;
    this.reportQueries.push(query);
    return Promise.resolve({
      text: '📊 Báo cáo',
      year: 2026,
      month: 8,
      summary: {
        year: 2026,
        month: 8,
        totalExpenses: 150000,
        totalIncome: 0,
        balance: -150000,
        entryCount: 1,
      },
      rows: [{ date: '18/08/2026', type: 'expense', content: 'ăn tối', amount: 150000 }],
    });
  }
  financialSummary(): Promise<ServiceResult> {
    this.financialSummaryCalls++;
    return Promise.resolve({ text: '📊 Tổng quan tài chính' });
  }
  isSummaryIntent() {
    return this.summaryIntent;
  }
  record(
    _signal: AbortSignal,
    updateId: number,
    text: string,
    options?: RecordOptions,
  ): Promise<ServiceResult> {
    this.recordCalls.push({ updateId, text, options });
    return Promise.resolve({ text: 'record' });
  }
  prepareImage() {
    if (this.imageError) return Promise.reject(this.imageError);
    return Promise.resolve({ text: 'image preview', token: 'opaque-token' });
  }
  confirmImage(): Promise<ServiceResult> {
    return Promise.resolve({ text: 'confirm' });
  }
  cancelImage(): Promise<ServiceResult> {
    return Promise.resolve({ text: 'cancel' });
  }
}

function update(text: string) {
  return {
    id: 1,
    message: {
      chatId: 42,
      userId: 42,
      text,
      caption: '',
      isBot: false,
    },
  } as const;
}

function callbackUpdate(data: string) {
  return {
    id: 2,
    callback: { id: 'callback', chatId: 42, userId: 42, messageId: 1, data },
  } as const;
}

function imageUpdate() {
  return {
    id: 3,
    message: {
      chatId: 42,
      userId: 42,
      text: '',
      caption: '',
      image: { fileId: 'image-file' },
      isBot: false,
    },
  } as const;
}

class FakeImageFetcher implements ImageFetcher {
  error?: Error;

  fetchImage() {
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve({ mimeType: 'image/png', data: new Uint8Array([1]) });
  }
}

Deno.test('image extraction failure is acknowledged after its fallback response', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  service.imageError = new Error('vision model cannot read image');
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
    imageFetcher: new FakeImageFetcher(),
  });

  await handler.handleUpdate(new AbortController().signal, imageUpdate());

  if (messenger.messages.length !== 1 || !messenger.messages[0]?.includes('chưa đọc được')) {
    throw new Error(JSON.stringify(messenger.messages));
  }
});

Deno.test('image download failure is acknowledged after its fallback response', async () => {
  const messenger = new FakeMessenger();
  const fetcher = new FakeImageFetcher();
  fetcher.error = new Error('download failed');
  const handler = new TelegramHandler({
    messenger,
    service: new FakeService(),
    authorizer: new TelegramAuthorizer(42),
    imageFetcher: fetcher,
  });

  await handler.handleUpdate(new AbortController().signal, imageUpdate());

  if (messenger.messages.length !== 1 || !messenger.messages[0]?.includes('Không thể đọc ảnh')) {
    throw new Error(JSON.stringify(messenger.messages));
  }
});

Deno.test('report command sends summary and one Markdown document', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(new AbortController().signal, update('/report'));
  if (
    service.reportCalls !== 1 || messenger.messages.length !== 1 || messenger.documents.length !== 1
  ) {
    throw new Error(JSON.stringify({ service, messenger }));
  }
  if (messenger.documents[0]?.filename !== 'money-report-2026-08.md') {
    throw new Error(messenger.documents[0]?.filename);
  }
});

Deno.test('report callback sends summary and one Markdown document', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(new AbortController().signal, callbackUpdate('cmd:report'));
  if (service.reportCalls !== 1 || messenger.documents.length !== 1) {
    throw new Error(JSON.stringify({ service, messenger }));
  }
});

Deno.test('natural-language report intent sends the report attachment', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  service.summaryIntent = true;
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(new AbortController().signal, update('chi tiêu tháng này'));
  if (
    service.reportCalls !== 1 || service.reportQueries[0] !== 'chi tiêu tháng này' ||
    messenger.documents.length !== 1
  ) {
    throw new Error(JSON.stringify({ service, messenger }));
  }
});

Deno.test('document delivery failure keeps the summary and sends a concise fallback', async () => {
  const messenger = new FakeMessenger();
  messenger.failDocument = true;
  const service = new FakeService();
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(new AbortController().signal, update('/report'));
  if (
    service.reportCalls !== 1 || messenger.messages.length !== 2 ||
    !messenger.messages[1]?.includes('không thể gửi tệp')
  ) throw new Error(JSON.stringify({ service, messenger }));
});

Deno.test('invest and saving commands route typed records with update IDs', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(
    new AbortController().signal,
    { ...update('/invest@money_bot crypto 5tr BTC'), id: 51 },
  );
  await handler.handleUpdate(
    new AbortController().signal,
    { ...update('/saving bank 10tr VCB'), id: 52 },
  );
  if (
    service.recordCalls.length !== 2 || service.recordCalls[0]?.updateId !== 51 ||
    service.recordCalls[0]?.text !== 'crypto 5tr BTC' ||
    service.recordCalls[0]?.options?.type !== 'invest' ||
    service.recordCalls[0]?.options?.originalMessage !== '/invest@money_bot crypto 5tr BTC' ||
    service.recordCalls[1]?.updateId !== 52 || service.recordCalls[1]?.options?.type !== 'saving'
  ) throw new Error(JSON.stringify(service.recordCalls));
});

Deno.test('typed commands without arguments show usage without recording', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(new AbortController().signal, update('/invest'));
  await handler.handleUpdate(new AbortController().signal, update('/saving@money_bot'));
  if (
    service.recordCalls.length !== 0 || !messenger.messages[0]?.includes('/invest <item>') ||
    !messenger.messages[1]?.includes('/saving <item>')
  ) throw new Error(JSON.stringify({ service, messenger }));
});

Deno.test('summary command sends all-time summary without a document', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(new AbortController().signal, update('/summary'));
  if (
    service.reportCalls !== 0 || service.financialSummaryCalls !== 1 ||
    messenger.messages[0] !== '📊 Tổng quan tài chính'
  ) {
    throw new Error(JSON.stringify({ service, messenger }));
  }
  if (messenger.documents.length !== 0) throw new Error('legacy command sent a document');
});
