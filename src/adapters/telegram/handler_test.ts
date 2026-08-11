import { TelegramAuthorizer } from './authz.ts';
import { TelegramHandler } from './handler.ts';
import type { DocumentAttachment, InlineKeyboard, Messenger, MoneyServicePort } from './types.ts';
import type { ReportResponse, ServiceResult } from '../../service/types.ts';

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
  reportQueries: string[] = [];
  summaryIntent = false;
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
  isSummaryIntent() {
    return this.summaryIntent;
  }
  record(): Promise<ServiceResult> {
    return Promise.resolve({ text: 'record' });
  }
  prepareImage(): never {
    throw new Error('unused');
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

Deno.test('summary command gives migration guidance without running a report', async () => {
  const messenger = new FakeMessenger();
  const service = new FakeService();
  const handler = new TelegramHandler({
    messenger,
    service,
    authorizer: new TelegramAuthorizer(42),
  });
  await handler.handleUpdate(new AbortController().signal, update('/summary'));
  if (service.reportCalls !== 0 || !messenger.messages[0]?.includes('/report')) {
    throw new Error(JSON.stringify({ service, messenger }));
  }
  if (messenger.documents.length !== 0) throw new Error('legacy command sent a document');
});
