import type { Transaction } from '../../domain/transaction.ts';
import { validateTransaction } from '../../domain/transaction.ts';
import { randomToken } from '../../shared/runtime.ts';
import type { PendingImage, PendingImageStore } from '../../service/image_pending_store.ts';
import type { BatchUpdateRequest, SheetsAPI } from './types.ts';

export const PENDING_HEADERS = [
  'Schema Version',
  'Token Hash',
  'Event',
  'Event At',
  'Expires At',
  'Source Update ID',
  'Transactions JSON',
];
const SCHEMA = '1';

export class SheetsPendingImageStore implements PendingImageStore {
  readonly #api: SheetsAPI;
  readonly #spreadsheetId: string;
  readonly #sheet: string;
  readonly #clock: () => Date;
  constructor(
    options: { api: SheetsAPI; spreadsheetId: string; sheet?: string; clock?: () => Date },
  ) {
    this.#api = options.api;
    this.#spreadsheetId = options.spreadsheetId;
    this.#sheet = options.sheet || '_money_bot_pending';
    this.#clock = options.clock || (() => new Date());
  }
  async add(
    signal: AbortSignal,
    transactions: Transaction[],
    updateId: number,
  ): Promise<string | undefined> {
    if (await this.countActive(signal) >= 16) return undefined;
    await this.ensure(signal);
    const token = randomToken(18);
    const hash = await hashToken(token);
    const now = this.#clock();
    await this.append(signal, [
      SCHEMA,
      hash,
      'created',
      now.toISOString(),
      new Date(now.getTime() + 600_000).toISOString(),
      String(updateId),
      JSON.stringify(transactions),
    ]);
    return token;
  }
  async getConfirmable(signal: AbortSignal, token: string): Promise<PendingImage | undefined> {
    const hash = await hashToken(token);
    const state = await this.state(signal, hash);
    if (!state || state.event !== 'created' || state.expiresAt <= this.#clock().getTime()) {
      return undefined;
    }
    try {
      const transactions = JSON.parse(state.transactions) as Transaction[];
      if (!Array.isArray(transactions)) return undefined;
      transactions.forEach(validateTransaction);
      return { transactions, updateId: Number(state.updateId), expiresAt: state.expiresAt };
    } catch {
      return undefined;
    }
  }
  async complete(signal: AbortSignal, token: string): Promise<void> {
    await this.ensure(signal);
    await this.append(signal, [
      SCHEMA,
      await hashToken(token),
      'completed',
      this.#clock().toISOString(),
      '',
      '',
      '',
    ]);
  }
  async cancel(signal: AbortSignal, token: string): Promise<boolean> {
    const hash = await hashToken(token);
    const state = await this.state(signal, hash);
    if (!state || state.event !== 'created' || state.expiresAt <= this.#clock().getTime()) {
      return false;
    }
    await this.append(signal, [SCHEMA, hash, 'cancelled', this.#clock().toISOString(), '', '', '']);
    return true;
  }
  async countActive(signal: AbortSignal): Promise<number> {
    await this.ensure(signal);
    const values = await this.#api.getValues(
      signal,
      this.#spreadsheetId,
      `${quote(this.#sheet)}!A2:G`,
    );
    const states = new Map<string, Row>();
    for (const row of values) {
      const parsed = parseRow(row);
      if (parsed) states.set(parsed.hash, parsed);
    }
    const now = this.#clock().getTime();
    let count = 0;
    for (const row of states.values()) if (row.event === 'created' && row.expiresAt > now) count++;
    return count;
  }
  private async state(signal: AbortSignal, hash: string): Promise<Row | undefined> {
    await this.ensure(signal);
    const values = await this.#api.getValues(
      signal,
      this.#spreadsheetId,
      `${quote(this.#sheet)}!A2:G`,
    );
    let result: Row | undefined;
    for (const row of values) {
      const parsed = parseRow(row);
      if (parsed?.hash === hash) result = parsed;
    }
    return result;
  }
  private async ensure(signal: AbortSignal): Promise<void> {
    const spreadsheet = await this.#api.getSpreadsheet(signal, this.#spreadsheetId);
    const found = spreadsheet.sheets.find((sheet) => sheet.title === this.#sheet);
    if (!found) {
      await this.#api.batchUpdate(signal, this.#spreadsheetId, {
        requests: [{ addSheet: { title: this.#sheet, hidden: true } }],
      });
      const created = (await this.#api.getSpreadsheet(signal, this.#spreadsheetId)).sheets.find((
        sheet,
      ) => sheet.title === this.#sheet);
      if (!created) throw new Error('pending worksheet was not created');
      await this.#api.batchUpdate(signal, this.#spreadsheetId, {
        requests: [{
          appendCells: { sheetId: created.id, sheetTitle: this.#sheet, values: [PENDING_HEADERS] },
        }],
      });
    } else if (!found.hidden) {
      await this.#api.batchUpdate(signal, this.#spreadsheetId, {
        requests: [{ updateSheetProperties: { sheetId: found.id, hidden: true } }],
      });
    }
  }
  private async append(signal: AbortSignal, values: string[]): Promise<void> {
    const sheet = (await this.#api.getSpreadsheet(signal, this.#spreadsheetId)).sheets.find((
      item,
    ) => item.title === this.#sheet);
    if (!sheet) throw new Error('pending worksheet not found');
    const request: BatchUpdateRequest = {
      requests: [{ appendCells: { sheetId: sheet.id, sheetTitle: this.#sheet, values: [values] } }],
    };
    await this.#api.batchUpdate(signal, this.#spreadsheetId, request);
  }
}
interface Row {
  hash: string;
  event: string;
  expiresAt: number;
  updateId: number;
  transactions: string;
}
function parseRow(row: string[]): Row | undefined {
  if (
    row.length < 7 || row[0] !== SCHEMA || !row[1] ||
    !['created', 'completed', 'cancelled'].includes(row[2] ?? '')
  ) return undefined;
  const expiresAt = row[4] ? Date.parse(row[4]) : 0;
  const updateId = Number(row[5]);
  return {
    hash: row[1]!,
    event: row[2]!,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    updateId,
    transactions: row[6] ?? '',
  };
}
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
}
function quote(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}
