import { configFromEnvironment } from './config.ts';

Deno.test('environment-only configuration works without config.yaml', () => {
  const values: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: '123:test-token',
    TELEGRAM_ALLOWED_USER_ID: '123456789',
    GOOGLE_SHEET_ID: 'spreadsheet-id',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@example.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'sk-test',
    AI_MODEL: 'text-model',
    AI_IMAGE_MODEL: 'vision-model',
    AI_BASE_URL: 'https://openrouter.ai/api/v1',
  };
  const config = configFromEnvironment({ get: (name) => values[name] });
  if (
    config.telegram.allowedUserId !== 123456789 || config.google.spreadsheetId !== 'spreadsheet-id'
  ) throw new Error('Telegram/Sheets env configuration failed');
  if (
    config.ai.provider !== 'openrouter' || config.ai.model !== 'text-model' ||
    config.ai.imageModel !== 'vision-model'
  ) throw new Error('AI env configuration failed');
  if (config.google.credentialSource.kind !== 'legacy_env') {
    throw new Error('legacy credential source was not selected');
  }
});
