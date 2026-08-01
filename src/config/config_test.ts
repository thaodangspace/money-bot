import { type Environment, normalizeConfig } from './config.ts';

const environment: Environment = {
  get(name) {
    return {
      TELEGRAM_BOT_TOKEN: 'telegram-secret',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      GOOGLE_SHEET_ID: 'sheet-id',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@example.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
      OPENROUTER_API_KEY: 'openrouter-secret',
      GOOGLE_JSON: '{}',
    }[name];
  },
};

Deno.test('config normalization resolves defaults, env values, and durations', () => {
  const config = normalizeConfig({
    telegram: {
      token: '',
      tokenEnv: 'TELEGRAM_BOT_TOKEN',
      allowedUserId: 123,
      maxImageBytes: 5_242_880,
    },
    google: {
      spreadsheetId: '',
      spreadsheetIdEnv: 'GOOGLE_SHEET_ID',
      credentialsFile: '',
      credentialsJSONEnv: '',
      serviceAccountEmailEnv: '',
      privateKeyEnv: '',
      metadataSheet: '',
      requestTimeout: '30s',
    },
    app: {
      timezone: '',
      updateTimeout: '30s',
      shutdownTimeout: '10s',
      maxInputRunes: 0,
      maxOutputRunes: 0,
    },
    ai: {
      provider: 'openrouter',
      apiKeyEnv: '',
      model: '',
      imageModel: '',
      baseURL: '',
      openrouterApiKeyEnv: 'OPENROUTER_API_KEY',
      openrouterModel: '',
      openrouterBaseURL: '',
      openrouterReferer: '',
      openrouterAppName: '',
      requestTimeout: '20s',
    },
  }, environment);
  if (config.telegram.token !== 'telegram-secret' || config.google.spreadsheetId !== 'sheet-id') {
    throw new Error('env values were not resolved');
  }
  if (
    config.app.updateTimeoutMs !== 30_000 || config.google.requestTimeoutMs !== 30_000 ||
    config.ai.requestTimeoutMs !== 20_000
  ) throw new Error('durations were not parsed');
  if (
    config.google.credentialSource.kind !== 'legacy_env' || config.ai.model === '' ||
    config.ai.baseURL === ''
  ) throw new Error('defaults were not applied');
});

Deno.test('config rejects unknown fields and multiple credential sources', () => {
  const raw = {
    telegram: { token: 'token', allowedUserId: 1 },
    google: {
      spreadsheetId: 'sheet',
      credentialsFile: 'key.json',
      serviceAccountEmailEnv: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      privateKeyEnv: 'GOOGLE_PRIVATE_KEY',
    },
    app: {},
    ai: {},
  };
  let unknown = false;
  try {
    normalizeConfig({ ...raw, telegram: { ...raw.telegram, unexpected: true } }, environment);
  } catch (error) {
    unknown = String(error).includes('unknown configuration field');
  }
  if (!unknown) throw new Error('unknown field was accepted');
  let multiple = false;
  try {
    normalizeConfig(raw, environment);
  } catch {
    multiple = true;
  }
  if (!multiple) throw new Error('multiple credential sources were accepted');
});
