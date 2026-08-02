import { AIClient } from './adapters/ai/client.ts';
import {
  parseServiceAccountCredentials,
  ServiceAccountTokenProvider,
} from './adapters/google_sheets/auth.ts';
import { GoogleSheetsHTTPClient } from './adapters/google_sheets/client.ts';
import { SheetsPendingImageStore } from './adapters/google_sheets/pending_store.ts';
import { SheetsRepository } from './adapters/google_sheets/repository.ts';
import { TelegramAuthorizer } from './adapters/telegram/authz.ts';
import { TelegramClient } from './adapters/telegram/client.ts';
import { TelegramHandler } from './adapters/telegram/handler.ts';
import { TelegramImageFetcher } from './adapters/telegram/image_fetcher.ts';
import { createWebhookHandler } from './adapters/telegram/webhook.ts';
import { type CredentialSource, loadConfig } from './config/config.ts';
import { MoneyService } from './service/money_service.ts';
import { createLogger, type LogLevel } from './shared/logger.ts';

export interface CLIOptions {
  configPath: string;
  dryRun: boolean;
  logLevel: string;
}
export interface RuntimeEnvironment {
  get(name: string): string | undefined;
}

export async function main(args: string[] = Deno.args): Promise<void> {
  const options = parseArgs(args);
  const logger = createLogger(toLogLevel(options.logLevel));
  const environment: RuntimeEnvironment = { get: (name) => Deno.env.get(name) };
  if (!shouldRunFullApplication(environment)) {
    await runHealthOnlyRuntime();
    return;
  }
  const config = await loadConfig(options.configPath);
  logger.info('config.loaded', {
    aiProvider: config.ai.provider,
    aiModel: config.ai.model,
    timezone: config.app.timezone,
    credentialSource: config.google.credentialSource.kind,
  });
  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      provider: config.ai.provider,
      model: config.ai.model,
      imageModel: config.ai.imageModel,
      timezone: config.app.timezone,
      spreadsheetConfigured: Boolean(config.google.spreadsheetId),
      credentialSource: config.google.credentialSource.kind,
    }));
    return;
  }
  const credentials = await readCredentials(config.google.credentialSource);
  const tokenProvider = new ServiceAccountTokenProvider(
    parseServiceAccountCredentials(credentials),
    fetch,
    logger,
  );
  const sheetsAPI = new GoogleSheetsHTTPClient(tokenProvider, {
    requestTimeoutMs: config.google.requestTimeoutMs,
    logger,
  });
  const repository = new SheetsRepository({
    api: sheetsAPI,
    spreadsheetId: config.google.spreadsheetId,
    metadataSheet: config.google.metadataSheet,
    timeZone: config.app.timezone,
    logger,
  });
  const ai = new AIClient({
    provider: config.ai.provider,
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    imageModel: config.ai.imageModel,
    baseURL: config.ai.baseURL,
    referer: config.ai.referer,
    appName: config.ai.appName,
    structuredOutput: config.ai.structuredOutput,
    requestTimeoutMs: config.ai.requestTimeoutMs,
    maxImageBytes: config.telegram.maxImageBytes,
    logger,
  });
  const service = new MoneyService({
    timeZone: config.app.timezone,
    ledger: repository,
    ai,
    comments: ai,
    pending: new SheetsPendingImageStore({
      api: sheetsAPI,
      spreadsheetId: config.google.spreadsheetId,
      sheet: config.google.pendingSheet,
    }),
    logger,
  });
  const telegram = new TelegramClient({ token: config.telegram.token, logger });
  const handler = new TelegramHandler({
    messenger: telegram,
    service,
    authorizer: new TelegramAuthorizer(config.telegram.allowedUserId),
    imageFetcher: new TelegramImageFetcher(telegram, config.telegram.maxImageBytes, fetch, logger),
    maxOutputRunes: config.app.maxOutputRunes,
    logger,
  });
  await runWebhookRuntime(
    createWebhookHandler(handler, {
      path: config.telegram.webhookPath,
      secret: config.telegram.webhookSecret,
      updateTimeoutMs: config.app.updateTimeoutMs,
      logger,
    }),
  );
}

export function shouldRunFullApplication(environment: RuntimeEnvironment): boolean {
  return !isDenoDeploy(environment) || environment.get('DENO_TIMELINE') === 'production';
}
function isDenoDeploy(environment: RuntimeEnvironment): boolean {
  return environment.get('DENO_DEPLOY') === 'true';
}

export async function runWebhookRuntime(
  webhook: (request: Request) => Response | Promise<Response>,
): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  Deno.addSignalListener('SIGINT', stop);
  Deno.addSignalListener('SIGTERM', stop);
  const portValue = Deno.env.get('APP_PORT') ?? '8000';
  const port = /^\d+$/u.test(portValue) ? Number(portValue) : 8000;
  const server = Deno.serve({ signal: controller.signal, port }, webhook);
  try {
    await server.finished;
  } finally {
    Deno.removeSignalListener('SIGINT', stop);
    Deno.removeSignalListener('SIGTERM', stop);
  }
}
async function runHealthOnlyRuntime(): Promise<void> {
  await runWebhookRuntime(healthResponse);
}
function healthResponse(request: Request): Response {
  const path = new URL(request.url).pathname;
  return request.method === 'GET' && (path === '/' || path === '/healthz')
    ? new Response('ok\n', {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    })
    : new Response('not found\n', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export function parseArgs(args: string[]): CLIOptions {
  let configPath = './config.yaml';
  let dryRun = false;
  let logLevel = 'info';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--config') {
      if (index + 1 >= args.length) {
        throw new Error(
          '--config requires a path or empty value for environment-only configuration',
        );
      }
      configPath = args[++index] ?? '';
    } else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--log-level') logLevel = args[++index] ?? '';
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: deno run src/main.ts [--config path] [--dry-run] [--log-level level]');
      return { configPath, dryRun: true, logLevel };
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!logLevel.trim()) throw new Error('--log-level requires a value');
  return { configPath, dryRun, logLevel };
}
function toLogLevel(value: string): LogLevel {
  const level = value.trim().toLowerCase();
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') return level;
  throw new Error(`unsupported --log-level: ${value}`);
}
async function readCredentials(source: CredentialSource): Promise<string> {
  if (source.kind === 'file') return await Deno.readTextFile(source.file);
  if (source.kind === 'json_env') return source.json;
  return JSON.stringify({
    type: 'service_account',
    client_email: source.email,
    private_key: source.privateKey,
  });
}
if (import.meta.main) {
  main().catch((error) => {
    console.error(String(error));
    Deno.exit(1);
  });
}
