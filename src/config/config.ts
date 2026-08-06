import { parseDuration } from './duration.ts';

export const DEFAULTS = {
  metadataSheet: '_money_bot_meta',
  pendingSheet: '_money_bot_pending',
  webhookPath: '/telegram/webhook',
  timezone: 'Asia/Ho_Chi_Minh',
  updateTimeoutMs: 30_000,
  shutdownTimeoutMs: 10_000,
  googleTimeoutMs: 30_000,
  aiTimeoutMs: 20_000,
  maxInputRunes: 2_000,
  maxOutputRunes: 3_900,
  maxImageBytes: 5 * 1024 * 1024,
  aiProvider: 'lmstudio',
  lmStudioBaseURL: 'http://localhost:1234/v1',
  lmStudioModel: 'local-model',
  openRouterBaseURL: 'https://openrouter.ai/api/v1',
  openRouterModel: 'z-ai/glm-4.5-air:free',
  openRouterReferer: 'https://github.com/thaodangspace/money-bot',
  openRouterAppName: 'money-bot',
};

export type CredentialSource =
  | { kind: 'file'; file: string }
  | { kind: 'json_env'; envName: string; json: string }
  | {
    kind: 'legacy_env';
    emailEnv: string;
    privateKeyEnv: string;
    email: string;
    privateKey: string;
  };

export interface AppConfig {
  timezone: string;
  updateTimeoutMs: number;
  shutdownTimeoutMs: number;
  maxInputRunes: number;
  maxOutputRunes: number;
}

export interface RuntimeConfig {
  telegram: {
    token: string;
    allowedUserId: number;
    maxImageBytes: number;
    webhookPath: string;
    webhookSecret: string;
  };
  google: {
    spreadsheetId: string;
    metadataSheet: string;
    pendingSheet: string;
    requestTimeoutMs: number;
    credentialSource: CredentialSource;
  };
  app: AppConfig;
  ai: {
    provider: string;
    apiKey: string;
    model: string;
    routerModel: string;
    imageModel: string;
    baseURL: string;
    referer: string;
    appName: string;
    structuredOutput: StructuredOutput;
    requestTimeoutMs: number;
  };
}

export type StructuredOutput = 'none' | 'json_object' | 'json_schema';

export interface Environment {
  get(name: string): string | undefined;
}

const systemEnvironment: Environment = { get: (name) => Deno.env.get(name) };

export async function loadConfig(
  path: string,
  environment: Environment = systemEnvironment,
): Promise<RuntimeConfig> {
  if (!path.trim()) return configFromEnvironment(environment);
  try {
    const text = await Deno.readTextFile(path);
    return normalizeConfig(parseYamlMap(text), environment, path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return configFromEnvironment(environment);
    throw error;
  }
}

/** Build configuration entirely from environment variables, useful for Deno Deploy. */
export function configFromEnvironment(environment: Environment = systemEnvironment): RuntimeConfig {
  const credentialsJSON = environment.get('GOOGLE_CREDENTIALS_JSON')?.trim();
  return normalizeConfig({
    telegram: {
      token: '',
      tokenEnv: 'TELEGRAM_BOT_TOKEN',
      allowedUserId: environment.get('TELEGRAM_ALLOWED_USER_ID') ?? '',
      maxImageBytes: environment.get('TELEGRAM_MAX_IMAGE_BYTES') ?? '',
      webhookPath: environment.get('TELEGRAM_WEBHOOK_PATH') ?? '',
      webhookSecretEnv: 'TELEGRAM_WEBHOOK_SECRET',
    },
    google: {
      spreadsheetId: '',
      spreadsheetIdEnv: 'GOOGLE_SHEET_ID',
      credentialsFile: '',
      credentialsJSONEnv: credentialsJSON ? 'GOOGLE_CREDENTIALS_JSON' : '',
      serviceAccountEmailEnv: credentialsJSON ? '' : 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      privateKeyEnv: credentialsJSON ? '' : 'GOOGLE_PRIVATE_KEY',
      metadataSheet: environment.get('GOOGLE_METADATA_SHEET') ?? '',
      pendingSheet: environment.get('GOOGLE_PENDING_SHEET') ?? '',
      requestTimeout: environment.get('GOOGLE_REQUEST_TIMEOUT') ?? '',
    },
    app: {
      timezone: environment.get('APP_TIMEZONE') ?? '',
      updateTimeout: environment.get('APP_UPDATE_TIMEOUT') ?? '',
      shutdownTimeout: environment.get('APP_SHUTDOWN_TIMEOUT') ?? '',
      maxInputRunes: environment.get('APP_MAX_INPUT_RUNES') ?? '',
      maxOutputRunes: environment.get('APP_MAX_OUTPUT_RUNES') ?? '',
    },
    ai: {
      enabled: true,
      provider: environment.get('AI_PROVIDER') ?? '',
      apiKeyEnv: 'AI_API_KEY',
      model: environment.get('AI_MODEL') ?? '',
      routerModel: environment.get('AI_ROUTER_MODEL') ?? '',
      imageModel: environment.get('AI_IMAGE_MODEL') ?? '',
      baseURL: environment.get('AI_BASE_URL') ?? '',
      openrouterApiKeyEnv: 'OPENROUTER_API_KEY',
      openrouterModel: environment.get('OPENROUTER_MODEL') ?? '',
      openrouterBaseURL: environment.get('OPENROUTER_BASE_URL') ?? '',
      openrouterReferer: environment.get('OPENROUTER_REFERER') ?? '',
      openrouterAppName: environment.get('OPENROUTER_APP_NAME') ?? '',
      structuredOutput: environment.get('AI_STRUCTURED_OUTPUT') ?? '',
      requestTimeout: environment.get('AI_REQUEST_TIMEOUT') ?? '',
    },
  }, environment);
}

/** Exported separately so schema and normalization tests do not need filesystem permissions. */
export function normalizeConfig(
  raw: Record<string, unknown>,
  environment: Environment,
  configPath = 'config.yaml',
): RuntimeConfig {
  assertKeys(raw, ['telegram', 'google', 'app', 'ai'], 'root');
  const telegram = objectAt(raw, 'telegram');
  const google = objectAt(raw, 'google');
  const app = objectAt(raw, 'app');
  const ai = objectAt(raw, 'ai');
  assertKeys(telegram, [
    'token',
    'tokenEnv',
    'allowedUserId',
    'maxImageBytes',
    'webhookPath',
    'webhookSecretEnv',
  ], 'telegram');
  assertKeys(google, [
    'spreadsheetId',
    'spreadsheetIdEnv',
    'credentialsFile',
    'credentialsJSONEnv',
    'serviceAccountEmailEnv',
    'privateKeyEnv',
    'metadataSheet',
    'pendingSheet',
    'requestTimeout',
  ], 'google');
  assertKeys(app, [
    'timezone',
    'updateTimeout',
    'shutdownTimeout',
    'maxInputRunes',
    'maxOutputRunes',
  ], 'app');
  assertKeys(ai, [
    'enabled',
    'provider',
    'apiKeyEnv',
    'model',
    'routerModel',
    'imageModel',
    'baseURL',
    'openrouterApiKeyEnv',
    'openrouterModel',
    'openrouterBaseURL',
    'openrouterReferer',
    'openrouterAppName',
    'structuredOutput',
    'requestTimeout',
  ], 'ai');

  const tokenEnv = stringValue(telegram.tokenEnv) || 'TELEGRAM_BOT_TOKEN';
  const token = stringValue(telegram.token) || environment.get(tokenEnv)?.trim() || '';
  const webhookPath = stringValue(telegram.webhookPath) || DEFAULTS.webhookPath;
  const webhookSecretEnv = stringValue(telegram.webhookSecretEnv) || 'TELEGRAM_WEBHOOK_SECRET';
  const webhookSecret = environment.get(webhookSecretEnv)?.trim() || '';
  const spreadsheetEnv = stringValue(google.spreadsheetIdEnv) || 'GOOGLE_SHEET_ID';
  const spreadsheetId = stringValue(google.spreadsheetId) ||
    environment.get(spreadsheetEnv)?.trim() || environment.get('GOOGLE_SHEET_ID')?.trim() || '';
  const credentialSource = resolveCredentialSource(google, environment, configPath);
  const provider = (stringValue(ai.provider) || DEFAULTS.aiProvider).toLowerCase();
  const openRouterKeyEnv = stringValue(ai.openrouterApiKeyEnv) || 'OPENROUTER_API_KEY';
  const apiKey = envValue(environment, stringValue(ai.apiKeyEnv))?.trim() ||
    envValue(environment, openRouterKeyEnv)?.trim() || '';
  const model = stringValue(ai.model) ||
    (provider === 'openrouter'
      ? stringValue(ai.openrouterModel) || DEFAULTS.openRouterModel
      : DEFAULTS.lmStudioModel);
  const routerModel = stringValue(ai.routerModel) || model;
  const baseURL = stringValue(ai.baseURL) ||
    (provider === 'openrouter'
      ? stringValue(ai.openrouterBaseURL) || DEFAULTS.openRouterBaseURL
      : DEFAULTS.lmStudioBaseURL);
  const imageModel = stringValue(ai.imageModel) || model;
  const result: RuntimeConfig = {
    telegram: {
      token,
      allowedUserId: integerValue(telegram.allowedUserId, 0),
      maxImageBytes: numberValue(telegram.maxImageBytes, DEFAULTS.maxImageBytes),
      webhookPath,
      webhookSecret,
    },
    google: {
      spreadsheetId,
      metadataSheet: stringValue(google.metadataSheet) || DEFAULTS.metadataSheet,
      pendingSheet: stringValue(google.pendingSheet) || DEFAULTS.pendingSheet,
      requestTimeoutMs: parseConfiguredDuration(google.requestTimeout, DEFAULTS.googleTimeoutMs),
      credentialSource,
    },
    app: {
      timezone: stringValue(app.timezone) || DEFAULTS.timezone,
      updateTimeoutMs: parseConfiguredDuration(app.updateTimeout, DEFAULTS.updateTimeoutMs),
      shutdownTimeoutMs: parseConfiguredDuration(app.shutdownTimeout, DEFAULTS.shutdownTimeoutMs),
      maxInputRunes: integerValue(app.maxInputRunes, DEFAULTS.maxInputRunes),
      maxOutputRunes: integerValue(app.maxOutputRunes, DEFAULTS.maxOutputRunes),
    },
    ai: {
      provider,
      apiKey,
      model,
      routerModel,
      imageModel,
      baseURL,
      referer: stringValue(ai.openrouterReferer) || DEFAULTS.openRouterReferer,
      appName: stringValue(ai.openrouterAppName) || DEFAULTS.openRouterAppName,
      structuredOutput: resolveStructuredOutput(ai.structuredOutput, provider),
      requestTimeoutMs: parseConfiguredDuration(ai.requestTimeout, DEFAULTS.aiTimeoutMs),
    },
  };
  validateConfig(result);
  return result;
}

function resolveCredentialSource(
  google: Record<string, unknown>,
  environment: Environment,
  configPath: string,
): CredentialSource {
  const candidates: CredentialSource[] = [];
  const file = stringValue(google.credentialsFile);
  if (file) candidates.push({ kind: 'file', file: expandPath(file, configPath) });
  const jsonEnv = stringValue(google.credentialsJSONEnv);
  if (jsonEnv) {
    const json = environment.get(jsonEnv)?.trim() || '';
    if (!json) throw new Error(`google credentials environment variable ${jsonEnv} is empty`);
    candidates.push({ kind: 'json_env', envName: jsonEnv, json });
  }
  const emailEnv = stringValue(google.serviceAccountEmailEnv);
  const privateKeyEnv = stringValue(google.privateKeyEnv);
  if (emailEnv || privateKeyEnv || (!file && !jsonEnv)) {
    const resolvedEmailEnv = emailEnv || 'GOOGLE_SERVICE_ACCOUNT_EMAIL';
    const resolvedKeyEnv = privateKeyEnv || 'GOOGLE_PRIVATE_KEY';
    const email = environment.get(resolvedEmailEnv)?.trim() || '';
    const privateKey = (environment.get(resolvedKeyEnv)?.trim() || '').replaceAll('\\n', '\n');
    if (!email || !privateKey) {
      throw new Error(
        `Google legacy credential environment variables ${resolvedEmailEnv} and ${resolvedKeyEnv} must both be set`,
      );
    }
    candidates.push({
      kind: 'legacy_env',
      emailEnv: resolvedEmailEnv,
      privateKeyEnv: resolvedKeyEnv,
      email,
      privateKey,
    });
  }
  if (candidates.length !== 1) {
    throw new Error(`Google credentials require exactly one source; got ${candidates.length}`);
  }
  return candidates[0]!;
}

function validateConfig(config: RuntimeConfig): void {
  const errors: string[] = [];
  if (!config.telegram.token) errors.push('telegram token is required');
  if (config.telegram.allowedUserId <= 0) errors.push('telegram.allowedUserId must be positive');
  if (!config.telegram.maxImageBytes || config.telegram.maxImageBytes <= 0) {
    errors.push('telegram.maxImageBytes must be positive');
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(config.telegram.webhookSecret)) {
    errors.push('telegram webhook secret must contain 1-256 letters, numbers, _ or -');
  }
  if (
    !config.telegram.webhookPath.startsWith('/') || config.telegram.webhookPath === '/' ||
    config.telegram.webhookPath.includes('?') || config.telegram.webhookPath.includes('#') ||
    config.telegram.webhookPath === '/healthz'
  ) errors.push('telegram webhook path is invalid');
  if (!config.google.spreadsheetId) errors.push('google.spreadsheetId is required');
  if (!config.app.timezone) {
    errors.push('app.timezone is required');
  } else {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: config.app.timezone }).format();
    } catch {
      errors.push('app.timezone is invalid');
    }
  }
  if (config.app.updateTimeoutMs <= 0 || config.app.shutdownTimeoutMs <= 0) {
    errors.push('app timeouts must be positive');
  }
  if (config.app.maxInputRunes <= 0 || config.app.maxOutputRunes <= 0) {
    errors.push('app rune limits must be positive');
  }
  if (!['lmstudio', 'openrouter', 'openai_compatible'].includes(config.ai.provider)) {
    errors.push('ai.provider is invalid');
  }
  if (!config.ai.model || !config.ai.baseURL) errors.push('ai.model and ai.baseURL are required');
  if (config.ai.provider === 'openrouter' && !config.ai.apiKey) {
    errors.push('openrouter API key is required');
  }
  if (
    config.ai.structuredOutput !== 'none' && config.ai.structuredOutput !== 'json_object' &&
    config.ai.structuredOutput !== 'json_schema'
  ) {
    errors.push('ai.structuredOutput must be none, json_object, or json_schema');
  }
  if (errors.length) throw new Error(errors.join('; '));
}

function resolveStructuredOutput(raw: unknown, provider: string): StructuredOutput {
  const value = stringValue(raw).toLowerCase();
  if (value === 'json_object' || value === 'json_schema' || value === 'none') {
    return value;
  }
  return provider === 'lmstudio' ? 'none' : 'json_schema';
}

function parseConfiguredDuration(value: unknown, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  return parseDuration(typeof value === 'number' ? value : String(value));
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const result = value[key];
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error(`${key} must be a mapping`);
  }
  return result as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) throw new Error(`unknown configuration field ${path}.${key}`);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function envValue(environment: Environment, name: string): string | undefined {
  return name ? environment.get(name) : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  if (value === undefined || value === '' || Number(value) === 0) return fallback;
  return Number(value);
}

function integerValue(value: unknown, fallback: number): number {
  const result = numberValue(value, fallback);
  return Number.isInteger(result) ? result : 0;
}

function expandPath(value: string, configPath: string): string {
  const home = Deno.env.get('HOME') || '';
  const expanded = value.startsWith('~/') ? `${home}/${value.slice(2)}` : value;
  return expanded.startsWith('/')
    ? expanded
    : `${configPath.slice(0, configPath.lastIndexOf('/') + 1)}${expanded}`;
}

function parseYamlMap(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; object: Record<string, unknown> }> = [{
    indent: -1,
    object: root,
  }];
  for (const [lineNumber, source] of text.split(/\r?\n/u).entries()) {
    if (!source.trim() || source.trim().startsWith('#')) continue;
    const indent = source.length - source.trimStart().length;
    const match = /^([^:#][^:]*):(?:\s*(.*))?$/u.exec(source.trim());
    if (!match) throw new Error(`invalid YAML at line ${lineNumber + 1}`);
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!.object;
    const key = match[1]!.trim();
    if (key in parent) throw new Error(`duplicate configuration field ${key}`);
    const raw = stripComment(match[2] ?? '').trim();
    if (!raw) {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, object: child });
    } else {
      parent[key] = parseScalar(raw);
    }
  }
  return root;
}

function stripComment(value: string): string {
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? '' : char;
    if (char === '#' && !quote && (index === 0 || /\s/u.test(value[index - 1]!))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function parseScalar(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  ) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return value;
}
