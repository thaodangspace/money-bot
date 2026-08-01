import { AIClient } from './adapters/ai/client.ts';
import {
  parseServiceAccountCredentials,
  ServiceAccountTokenProvider,
} from './adapters/google_sheets/auth.ts';
import { GoogleSheetsHTTPClient } from './adapters/google_sheets/client.ts';
import { SheetsRepository } from './adapters/google_sheets/repository.ts';
import { TelegramClient } from './adapters/telegram/client.ts';
import { TelegramHandler } from './adapters/telegram/handler.ts';
import { TelegramImageFetcher } from './adapters/telegram/image_fetcher.ts';
import { TelegramAuthorizer } from './adapters/telegram/authz.ts';
import { runPolling } from './adapters/telegram/polling.ts';
import { type CredentialSource, loadConfig } from './config/config.ts';
import { MoneyService } from './service/money_service.ts';
import { createLogger, errorFields, type LogLevel } from './shared/logger.ts';

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
  logger.info('app.start', {
    configPath: options.configPath || '<environment>',
    logLevel: options.logLevel,
    dryRun: options.dryRun,
    deploy: environment.get('DENO_DEPLOY') === 'true',
    timeline: environment.get('DENO_TIMELINE') ?? 'local',
  });
  if (!shouldRunPolling(environment)) {
    logger.info('polling.disabled', { reason: 'non-production deploy timeline' });
    console.log('Telegram polling disabled outside the Deno Deploy production timeline');
    await runHealthServer();
    return;
  }

  let config;
  try {
    config = await loadConfig(options.configPath);
    logger.info('config.loaded', {
      aiProvider: config.ai.provider,
      aiModel: config.ai.model,
      imageModel: config.ai.imageModel,
      timezone: config.app.timezone,
      credentialSource: config.google.credentialSource.kind,
    });
  } catch (error) {
    logger.error('config.load.failed', errorFields(error));
    throw error;
  }
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
    requestTimeoutMs: config.ai.requestTimeoutMs,
    maxImageBytes: config.telegram.maxImageBytes,
    logger,
  });
  const service = new MoneyService({
    timeZone: config.app.timezone,
    ledger: repository,
    ai,
    comments: ai,
    logger,
  });
  const telegram = new TelegramClient({ token: config.telegram.token, logger });
  const imageFetcher = new TelegramImageFetcher(
    telegram,
    config.telegram.maxImageBytes,
    fetch,
    logger,
  );
  const handler = new TelegramHandler({
    messenger: telegram,
    service,
    authorizer: new TelegramAuthorizer(config.telegram.allowedUserId),
    imageFetcher,
    maxOutputRunes: config.app.maxOutputRunes,
    logger,
  });

  const controller = new AbortController();
  const stop = () => controller.abort();
  Deno.addSignalListener('SIGINT', stop);
  Deno.addSignalListener('SIGTERM', stop);
  const healthServer = isDenoDeploy(environment)
    ? Deno.serve({ signal: controller.signal }, healthResponse)
    : undefined;
  logger.info('polling.start', { updateTimeoutMs: config.app.updateTimeoutMs });
  try {
    await runPolling(controller.signal, telegram, handler, {
      updateTimeoutMs: config.app.updateTimeoutMs,
      logger,
    });
  } catch (error) {
    logger.error('polling.failed', errorFields(error));
    throw error;
  } finally {
    logger.info('app.stop');
    controller.abort();
    await healthServer?.finished;
    Deno.removeSignalListener('SIGINT', stop);
    Deno.removeSignalListener('SIGTERM', stop);
  }
}

export function shouldRunPolling(environment: RuntimeEnvironment): boolean {
  return !isDenoDeploy(environment) || environment.get('DENO_TIMELINE') === 'production';
}

function isDenoDeploy(environment: RuntimeEnvironment): boolean {
  return environment.get('DENO_DEPLOY') === 'true';
}

async function runHealthServer(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  Deno.addSignalListener('SIGINT', stop);
  Deno.addSignalListener('SIGTERM', stop);
  const server = Deno.serve({ signal: controller.signal }, healthResponse);
  try {
    await server.finished;
  } finally {
    Deno.removeSignalListener('SIGINT', stop);
    Deno.removeSignalListener('SIGTERM', stop);
  }
}

function healthResponse(): Response {
  return new Response('ok\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
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
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--log-level') {
      logLevel = args[++index] ?? '';
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: deno run src/main.ts [--config path] [--dry-run] [--log-level level]');
      return { configPath, dryRun: true, logLevel };
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
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
