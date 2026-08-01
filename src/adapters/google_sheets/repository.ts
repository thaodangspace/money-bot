import { currentPlainDate } from '../../shared/calendar.ts';
import {
  type Transaction,
  TRANSACTION_EXPENSE,
  TRANSACTION_INCOME,
  validateTransaction,
} from '../../domain/transaction.ts';
import { type MonthlySummary, newMonthlySummary } from '../../domain/summary.ts';
import {
  type AppendBatchResult,
  type BatchUpdateRequest,
  METADATA_HEADERS,
  METADATA_SCHEMA_VERSION,
  SheetNotFoundError,
  type SheetsAPI,
} from './types.ts';
import { GoogleHTTPError } from './client.ts';
import { elapsedMs, errorFields, type Logger, nullLogger } from '../../shared/logger.ts';

export interface SheetsRepositoryOptions {
  api: SheetsAPI;
  spreadsheetId: string;
  metadataSheet?: string;
  timeZone?: string;
  clock?: () => Date;
  maxRetries?: number;
  logger?: Logger;
}

export class SheetsRepository {
  readonly #api: SheetsAPI;
  readonly #spreadsheetId: string;
  readonly #metadataSheet: string;
  readonly #timeZone: string;
  readonly #clock: () => Date;
  readonly #maxRetries: number;
  readonly #logger: Logger;

  constructor(options: SheetsRepositoryOptions) {
    if (!options.spreadsheetId.trim()) throw new Error('spreadsheet ID is required');
    this.#api = options.api;
    this.#spreadsheetId = options.spreadsheetId;
    this.#metadataSheet = options.metadataSheet?.trim() || '_money_bot_meta';
    this.#timeZone = options.timeZone ?? 'Asia/Ho_Chi_Minh';
    this.#clock = options.clock ?? (() => new Date());
    this.#maxRetries = options.maxRetries ?? 1;
    this.#logger = options.logger ?? nullLogger;
  }

  async appendTransactions(
    signal: AbortSignal,
    updateId: number,
    transactions: Transaction[],
  ): Promise<AppendBatchResult> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.info('ledger.append.start', {
      from: 'MoneyService',
      to: 'SheetsRepository.appendTransactions',
      updateId,
      transactionCount: transactions.length,
    });
    if (updateId <= 0) throw new Error('source update ID is required');
    if (transactions.length === 0) throw new Error('at least one transaction is required');
    for (const transaction of transactions) validateTransaction(transaction);

    const now = this.#clock();
    const normalized = transactions.map((transaction) => ({
      transaction,
      date: transaction.date ?? currentPlainDate(now, this.#timeZone),
    }));
    const targetSheets = [...new Set(normalized.map(({ date }) => monthSheetFromDate(date)))];

    await this.#ensureSheets(signal, targetSheets);
    if (await this.#hasUpdateID(signal, updateId)) {
      logger.info('ledger.append.duplicate', {
        from: 'SheetsRepository.appendTransactions',
        to: 'Google Sheets',
        durationMs: elapsedMs(started),
        updateId,
        targetSheets,
      });
      return { status: 'duplicate', targetSheets };
    }
    const ids = await this.#sheetIDs(signal);
    const metadataID = ids.get(this.#metadataSheet);
    if (metadataID === undefined) throw new Error('metadata worksheet ID not found after ensure');
    const requests = normalized.map(({ transaction, date }) => {
      const sheet = monthSheetFromDate(date);
      const sheetID = ids.get(sheet);
      if (sheetID === undefined) throw new Error(`worksheet ID not found: ${sheet}`);
      return {
        appendCells: {
          sheetId: sheetID,
          sheetTitle: sheet,
          values: [[
            formatDate(date),
            transaction.type,
            transactionContent(transaction),
            String(transaction.amount),
          ]],
        },
      };
    });
    requests.push({
      appendCells: {
        sheetId: metadataID,
        sheetTitle: this.#metadataSheet,
        values: [[
          METADATA_SCHEMA_VERSION,
          String(updateId),
          this.#clock().toISOString(),
          targetSheets.join(','),
          'written',
        ]],
      },
    });

    const request: BatchUpdateRequest = { requests };
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      try {
        await this.#api.batchUpdate(signal, this.#spreadsheetId, request);
        logger.info('ledger.append.success', {
          from: 'SheetsRepository.appendTransactions',
          to: 'Google Sheets',
          durationMs: elapsedMs(started),
          updateId,
          targetSheets,
          attempt: attempt + 1,
        });
        return { status: 'written', targetSheets };
      } catch (error) {
        lastError = error;
        if (!isAmbiguous(error) || attempt === this.#maxRetries) break;
        if (await this.#hasUpdateID(signal, updateId)) {
          logger.info('ledger.append.success_after_retry', {
            from: 'SheetsRepository.appendTransactions',
            to: 'Google Sheets',
            durationMs: elapsedMs(started),
            updateId,
            targetSheets,
            attempt: attempt + 1,
          });
          return { status: 'written', targetSheets };
        }
      }
    }
    const error = lastError instanceof Error ? lastError : new Error(String(lastError));
    logger.error('ledger.append.failed', {
      from: 'SheetsRepository.appendTransactions',
      to: 'Google Sheets',
      durationMs: elapsedMs(started),
      updateId,
      ...errorFields(error),
    });
    throw error;
  }

  async monthlySummary(signal: AbortSignal, year: number, month: number): Promise<MonthlySummary> {
    const logger = this.#logger.forSignal(signal);
    const started = performance.now();
    logger.info('ledger.summary.start', {
      from: 'MoneyService',
      to: 'SheetsRepository.monthlySummary',
      year,
      month,
    });
    let totalExpenses = 0;
    let totalIncome = 0;
    let entryCount = 0;
    try {
      const rows = await this.#api.getValues(
        signal,
        this.#spreadsheetId,
        `${quoteSheet(monthSheet(year, month))}!A:D`,
      );
      const result = summarizeFlatRows(rows, year, month);
      totalExpenses += result.expenses;
      totalIncome += result.income;
      entryCount += result.count;
    } catch (error) {
      if (!(error instanceof SheetNotFoundError)) throw error;
    }
    try {
      const rows = await this.#api.getValues(
        signal,
        this.#spreadsheetId,
        `${quoteSheet(String(month))}!A2:D`,
      );
      const result = summarizeLegacyRows(rows, year, month);
      totalExpenses += result.expenses;
      totalIncome += result.income;
      entryCount += result.count;
    } catch (error) {
      if (!(error instanceof SheetNotFoundError)) throw error;
    }
    logger.info('ledger.summary.success', {
      from: 'SheetsRepository.monthlySummary',
      to: 'MoneyService',
      durationMs: elapsedMs(started),
      year,
      month,
      entryCount,
    });
    return newMonthlySummary(year, month, totalExpenses, totalIncome, entryCount);
  }

  async #ensureSheets(signal: AbortSignal, targetSheets: string[]): Promise<void> {
    const spreadsheet = await this.#api.getSpreadsheet(signal, this.#spreadsheetId);
    const sheets = new Map(spreadsheet.sheets.map((sheet) => [sheet.title, sheet]));
    const requests: BatchUpdateRequest['requests'] = [];
    for (const title of targetSheets) {
      if (!sheets.has(title)) requests.push({ addSheet: { title } });
    }
    const metadata = sheets.get(this.#metadataSheet);
    if (!metadata) {
      requests.push({ addSheet: { title: this.#metadataSheet, hidden: true } });
    } else {
      if (!metadata.hidden) {
        requests.push({ updateSheetProperties: { sheetId: metadata.id, hidden: true } });
      }
      await this.#validateMetadataHeader(signal);
    }
    if (requests.length === 0) return;
    await this.#api.batchUpdate(signal, this.#spreadsheetId, { requests });
    if (!metadata) {
      const ids = await this.#sheetIDs(signal);
      const metadataID = ids.get(this.#metadataSheet);
      if (metadataID === undefined) {
        throw new Error('metadata worksheet ID not found after creation');
      }
      await this.#api.batchUpdate(signal, this.#spreadsheetId, {
        requests: [{
          appendCells: {
            sheetId: metadataID,
            sheetTitle: this.#metadataSheet,
            values: [METADATA_HEADERS],
          },
        }],
      });
    }
  }

  async #validateMetadataHeader(signal: AbortSignal): Promise<void> {
    const values = await this.#api.getValues(
      signal,
      this.#spreadsheetId,
      `${quoteSheet(this.#metadataSheet)}!A1:E1`,
    );
    if (values.length === 0) {
      throw new Error(`metadata sheet ${this.#metadataSheet} missing header`);
    }
    const row = [...values[0]!];
    while (row.length < METADATA_HEADERS.length) row.push('');
    for (let index = 0; index < METADATA_HEADERS.length; index++) {
      if (row[index] !== METADATA_HEADERS[index]) {
        throw new Error(
          `metadata sheet ${this.#metadataSheet} header column ${index + 1} mismatch`,
        );
      }
    }
  }

  async #hasUpdateID(signal: AbortSignal, updateId: number): Promise<boolean> {
    try {
      const values = await this.#api.getValues(
        signal,
        this.#spreadsheetId,
        `${quoteSheet(this.#metadataSheet)}!A2:E`,
      );
      return values.some((row) => row.length >= 2 && row[1]!.trim() === String(updateId));
    } catch (error) {
      if (error instanceof SheetNotFoundError) return false;
      throw error;
    }
  }

  async #sheetIDs(signal: AbortSignal): Promise<Map<string, number>> {
    const spreadsheet = await this.#api.getSpreadsheet(signal, this.#spreadsheetId);
    return new Map(spreadsheet.sheets.map((sheet) => [sheet.title, sheet.id]));
  }
}

function transactionContent(transaction: Transaction): string {
  const category = transaction.category.trim().split(/\s+/u).filter(Boolean).join(' ');
  const original = (transaction.originalMessage ?? '').trim().split(/\s+/u).filter(Boolean).join(
    ' ',
  );
  if (original) return category ? `(${category}) ${original}` : original;
  const note = (transaction.note ?? '').trim().split(/\s+/u).filter(Boolean).join(' ');
  return [category, note].filter(Boolean).join(' ');
}

function monthSheetFromDate(date: `${number}-${number}-${number}`): string {
  return date.slice(0, 7);
}

function monthSheet(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function formatDate(date: `${number}-${number}-${number}`): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function quoteSheet(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

function summarizeFlatRows(
  rows: string[][],
  year: number,
  month: number,
): { expenses: number; income: number; count: number } {
  let expenses = 0;
  let income = 0;
  let count = 0;
  for (const row of rows) {
    if (row.length < 4 || !validDate(row[0]!, year, month)) continue;
    const amount = parseSheetAmount(row[3]!);
    if (amount === undefined) continue;
    if (row[1]!.trim().toLowerCase() === TRANSACTION_EXPENSE) {
      expenses = safeAdd(expenses, amount);
      count++;
    }
    if (row[1]!.trim().toLowerCase() === TRANSACTION_INCOME) {
      income = safeAdd(income, amount);
      count++;
    }
  }
  return { expenses, income, count };
}

function summarizeLegacyRows(
  rows: string[][],
  year: number,
  month: number,
): { expenses: number; income: number; count: number } {
  let include = false;
  let expenses = 0;
  let income = 0;
  let count = 0;
  for (const row of rows) {
    if (/^\d{2}\/\d{2}\/\d{4}$/u.test((row[0] ?? '').trim())) {
      include = validDate(row[0]!, year, month);
      continue;
    }
    if (!include || row.every((cell) => !cell.trim())) continue;
    const expense = parseSheetAmount(row[1] ?? '');
    const incomeValue = parseSheetAmount(row[2] ?? '');
    if (expense !== undefined) {
      expenses = safeAdd(expenses, expense);
      count++;
    }
    if (incomeValue !== undefined) {
      income = safeAdd(income, incomeValue);
      count++;
    }
  }
  return { expenses, income, count };
}

function validDate(value: string, year: number, month: number): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value.trim());
  if (!match || Number(match[2]) !== month || Number(match[3]) !== year) return false;
  const day = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function safeAdd(left: number, right: number): number {
  if (left > Number.MAX_SAFE_INTEGER - right) {
    throw new Error('spreadsheet summary exceeds safe integer range');
  }
  return left + right;
}

function parseSheetAmount(value: string): number | undefined {
  const clean = value.replaceAll('₫', '').replace(/\s+/gu, '').replace(/[.,]/gu, '');
  if (!/^\d+$/u.test(clean)) return undefined;
  const amount = Number(clean);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

function isAmbiguous(error: unknown): boolean {
  if (error instanceof GoogleHTTPError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError ||
    (error instanceof Error && /request failed/iu.test(error.message));
}
