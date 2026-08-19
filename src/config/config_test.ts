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
      allowedUserIds: '123',
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

Deno.test('config defaults structured output to JSON schema and honors explicit values', () => {
  const jsonEnvironment: Environment = {
    ...environment,
    get(name) {
      return name === 'GOOGLE_CREDENTIALS_JSON' ? '{}' : environment.get(name);
    },
  };
  const base = {
    telegram: { token: 't', tokenEnv: 'TELEGRAM_BOT_TOKEN', allowedUserIds: '1' },
    google: { spreadsheetId: 'sheet', credentialsJSONEnv: 'GOOGLE_CREDENTIALS_JSON' },
    app: {},
  };
  const first = normalizeConfig({ ...base, ai: { provider: 'openrouter' } }, jsonEnvironment);
  if (first.ai.structuredOutput !== 'json_schema') {
    throw new Error(`structuredOutput: ${first.ai.structuredOutput}`);
  }
  const none = normalizeConfig(
    { ...base, ai: { provider: 'openrouter', structuredOutput: 'none' } },
    jsonEnvironment,
  );
  if (none.ai.structuredOutput !== 'none') throw new Error('none was not honored');
  const lm = normalizeConfig({ ...base, ai: { provider: 'lmstudio' } }, jsonEnvironment);
  if (lm.ai.structuredOutput !== 'none') throw new Error('lmstudio default should be none');
});

Deno.test('config rejects malformed allowedUserIds tokens', () => {
  const base = {
    telegram: { token: 't', tokenEnv: 'TELEGRAM_BOT_TOKEN', allowedUserIds: '' },
    google: { spreadsheetId: 'sheet', credentialsFile: 'key.json' },
    app: {},
    ai: {},
  };
  const cases: Array<{ input: string; desc: string }> = [
    { input: '42,abc', desc: 'mixed valid and non-integer' },
    { input: '42,-1', desc: 'negative integer' },
    { input: '42,3.5', desc: 'fractional value' },
    { input: '42,', desc: 'trailing comma (empty token)' },
    { input: ',42', desc: 'leading comma (empty token)' },
    { input: '42,,99', desc: 'consecutive commas' },
    { input: 'abc', desc: 'purely non-numeric' },
    { input: '0', desc: 'zero is not positive' },
  ];
  for (const { input, desc } of cases) {
    let threw = false;
    try {
      normalizeConfig({ ...base, telegram: { ...base.telegram, allowedUserIds: input } }, environment);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`allowedUserIds "${input}" (${desc}) was not rejected`);
  }
});

Deno.test('config accepts valid allowedUserIds lists and normalizes the example shape', () => {
  const valid = normalizeConfig(
    {
      telegram: { token: 't', tokenEnv: 'TELEGRAM_BOT_TOKEN', allowedUserIds: '123,456,789' },
      google: { spreadsheetId: 'sheet', credentialsFile: '', serviceAccountEmailEnv: 'GOOGLE_SERVICE_ACCOUNT_EMAIL', privateKeyEnv: 'GOOGLE_PRIVATE_KEY' },
      app: {},
      ai: {},
    },
    environment,
  );
  if (valid.telegram.allowedUserIds.join(',') !== '123,456,789') {
    throw new Error(`expected 123,456,789 got ${valid.telegram.allowedUserIds.join(',')}`);
  }
});

Deno.test('config normalizes the shipped example without drift', () => {
  const example = {
    telegram: {
      tokenEnv: 'TELEGRAM_BOT_TOKEN',
      token: '',
      allowedUserIds: '123456789',
      maxImageBytes: 5_242_880,
      webhookPath: '/telegram/webhook',
      webhookSecretEnv: 'TELEGRAM_WEBHOOK_SECRET',
    },
    google: {
      spreadsheetId: '',
      spreadsheetIdEnv: 'GOOGLE_SHEET_ID',
      credentialsFile: '',
      credentialsJSONEnv: '',
      serviceAccountEmailEnv: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      privateKeyEnv: 'GOOGLE_PRIVATE_KEY',
      metadataSheet: '_money_bot_meta',
      pendingSheet: '_money_bot_pending',
      requestTimeout: '30s',
    },
    app: {
      timezone: 'Asia/Ho_Chi_Minh',
      updateTimeout: '30s',
      shutdownTimeout: '10s',
      maxInputRunes: 2_000,
      maxOutputRunes: 3_900,
    },
    ai: {
      provider: 'lmstudio',
      model: 'local-model',
      imageModel: 'local-model',
      baseURL: 'http://localhost:1234/v1',
      apiKeyEnv: '',
      openrouterReferer: 'https://github.com/thaodangspace/money-bot',
      openrouterAppName: 'money-bot',
      requestTimeout: '20s',
    },
  };
  const config = normalizeConfig(example, environment);
  if (config.telegram.allowedUserIds.join(',') !== '123456789') {
    throw new Error(`shipped example allowedUserIds mismatch: ${config.telegram.allowedUserIds.join(',')}`);
  }
  if (config.telegram.token !== 'telegram-secret') {
    throw new Error('shipped example token env was not resolved');
  }
  if (config.google.spreadsheetId !== 'sheet-id') {
    throw new Error('shipped example spreadsheetId env was not resolved');
  }
});

Deno.test('config accepts a multi-user shipped example without drift', () => {
  const example = {
    telegram: {
      tokenEnv: 'TELEGRAM_BOT_TOKEN',
      token: '',
      allowedUserIds: '123456789,987654321',
      maxImageBytes: 5_242_880,
      webhookPath: '/telegram/webhook',
      webhookSecretEnv: 'TELEGRAM_WEBHOOK_SECRET',
    },
    google: {
      spreadsheetId: '',
      spreadsheetIdEnv: 'GOOGLE_SHEET_ID',
      credentialsFile: '',
      credentialsJSONEnv: '',
      serviceAccountEmailEnv: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      privateKeyEnv: 'GOOGLE_PRIVATE_KEY',
      metadataSheet: '_money_bot_meta',
      pendingSheet: '_money_bot_pending',
      requestTimeout: '30s',
    },
    app: { timezone: 'Asia/Ho_Chi_Minh', updateTimeout: '30s', shutdownTimeout: '10s', maxInputRunes: 2_000, maxOutputRunes: 3_900 },
    ai: { provider: 'lmstudio', model: 'local-model', imageModel: 'local-model', baseURL: 'http://localhost:1234/v1', apiKeyEnv: '', openrouterReferer: 'https://github.com/thaodangspace/money-bot', openrouterAppName: 'money-bot', requestTimeout: '20s' },
  };
  const config = normalizeConfig(example, environment);
  if (config.telegram.allowedUserIds.join(',') !== '123456789,987654321') {
    throw new Error(`multi-user example mismatch: ${config.telegram.allowedUserIds.join(',')}`);
  }
});

Deno.test('config rejects unknown fields and multiple credential sources', () => {
  const raw = {
    telegram: { token: 'token', allowedUserIds: '1' },
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
