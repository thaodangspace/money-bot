import { parseConversationIntentJSON } from '../adapters/ai/validation.ts';

Deno.test('conversation intent validation accepts allow-listed actions', () => {
  const transaction = parseConversationIntentJSON(
    '{"kind":"record_transaction","transaction":{"type":"expense","category":"food","amount":150000,"note":"ăn tối"}}',
  );
  if (transaction.kind !== 'record_transaction' || transaction.transaction.amount !== 150000) {
    throw new Error(JSON.stringify(transaction));
  }
  const summary = parseConversationIntentJSON(
    '{"kind":"monthly_summary","period":{"relative":"previous_month"}}',
  );
  if (summary.kind !== 'monthly_summary' || !('relative' in summary.period)) {
    throw new Error(JSON.stringify(summary));
  }
  for (
    const content of [
      '{"kind":"record_transaction","transaction":{"type":"expense","category":"food","amount":1,"note":"","extra":true}}',
      '{"kind":"monthly_summary","period":{"relative":"current_month","year":2026}}',
      '{"kind":"delete_sheet","reply":"do it"}',
      '{"kind":"clarify","question":"ok","reply":"extra"}',
    ]
  ) {
    let rejected = false;
    try {
      parseConversationIntentJSON(content);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`unsafe intent accepted: ${content}`);
  }
});
