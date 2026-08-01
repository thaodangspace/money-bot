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

export interface CLIOptions {
  configPath: string;
  dryRun: boolean;
  logLevel: string;
}

export async function main(args: string[] = Deno.args): Promise<void> {
  const options = parseArgs(args);
  const config = await loadConfig(options.configPath);
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
  );
  const sheetsAPI = new GoogleSheetsHTTPClient(tokenProvider, {
    requestTimeoutMs: config.google.requestTimeoutMs,
  });
  const repository = new SheetsRepository({
    api: sheetsAPI,
    spreadsheetId: config.google.spreadsheetId,
    metadataSheet: config.google.metadataSheet,
    timeZone: config.app.timezone,
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
  });
  const service = new MoneyService({
    timeZone: config.app.timezone,
    ledger: repository,
    ai,
    comments: ai,
  });
  const telegram = new TelegramClient({ token: config.telegram.token });
  const imageFetcher = new TelegramImageFetcher(telegram, config.telegram.maxImageBytes);
  const handler = new TelegramHandler({
    messenger: telegram,
    service,
    authorizer: new TelegramAuthorizer(config.telegram.allowedUserId),
    imageFetcher,
    maxOutputRunes: config.app.maxOutputRunes,
  });

  const controller = new AbortController();
  const stop = () => controller.abort();
  Deno.addSignalListener('SIGINT', stop);
  Deno.addSignalListener('SIGTERM', stop);
  try {
    await runPolling(controller.signal, telegram, handler, {
      updateTimeoutMs: config.app.updateTimeoutMs,
    });
  } finally {
    Deno.removeSignalListener('SIGINT', stop);
    Deno.removeSignalListener('SIGTERM', stop);
  }
}

export function parseArgs(args: string[]): CLIOptions {
  let configPath = './config.yaml';
  let dryRun = false;
  let logLevel = 'info';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--config') {
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
  if (!configPath.trim()) throw new Error('--config requires a path');
  if (!logLevel.trim()) throw new Error('--log-level requires a value');
  return { configPath, dryRun, logLevel };
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
