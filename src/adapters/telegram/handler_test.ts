import { TelegramAuthorizer } from './authz.ts';
import { TelegramHandler } from './handler.ts';
import type { DocumentAttachment, InlineKeyboard, Messenger, MoneyServicePort } from './types.ts';
import type { ReportResponse, ServiceResult } from '../../service/types.ts';

class FakeMessenger implements Messenger {
  messages: string[] = [];
  documents: DocumentAttachment[] = [];

  sendMessage(_signal: AbortSignal, _chatId: number, text: string, _keyboard?: InlineKeyboard) {
    this.messages.push(text);
    return Promise.resolve();
  }
  sendDocument(
    _signal: AbortSignal,
    _chatId: number,
    document: DocumentAttachment,
  ) {
    this.documents.push(document);
    return Promise.resolve();
  }
  answerCallback() {
    return Promise.resolve();
  }
}

class FakeService implements MoneyServicePort {
  reportCalls = 0;
  report(): Promise<ReportResponse> {
    this.reportCalls++;
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
    return false;
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
