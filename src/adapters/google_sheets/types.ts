import type { Transaction } from '../../domain/transaction.ts';
import type { MonthlySummary } from '../../domain/summary.ts';

export const METADATA_SCHEMA_VERSION = '1';
export const METADATA_HEADERS = [
  'Schema Version',
  'Update ID',
  'Processed At',
  'Target Sheet',
  'Outcome',
];

export interface Spreadsheet {
  sheets: Sheet[];
}

export interface Sheet {
  id: number;
  title: string;
  hidden: boolean;
}

export interface AddSheetRequest {
  title: string;
  hidden?: boolean;
}

export interface UpdateSheetPropertiesRequest {
  sheetId: number;
  hidden: boolean;
}

export interface AppendCellsRequest {
  sheetId: number;
  sheetTitle: string;
  values: string[][];
}

export interface SheetRequest {
  addSheet?: AddSheetRequest;
  updateSheetProperties?: UpdateSheetPropertiesRequest;
  appendCells?: AppendCellsRequest;
}

export interface BatchUpdateRequest {
  requests: SheetRequest[];
}

export interface SheetsAPI {
  getSpreadsheet(signal: AbortSignal, spreadsheetId: string): Promise<Spreadsheet>;
  getValues(signal: AbortSignal, spreadsheetId: string, range: string): Promise<string[][]>;
  batchUpdate(
    signal: AbortSignal,
    spreadsheetId: string,
    request: BatchUpdateRequest,
  ): Promise<void>;
}

export type AppendStatus = 'written' | 'duplicate';

export interface AppendBatchResult {
  status: AppendStatus;
  targetSheets: string[];
}

export interface SheetsLedger {
  appendTransactions(
    signal: AbortSignal,
    updateId: number,
    transactions: Transaction[],
  ): Promise<AppendBatchResult>;
  monthlySummary(signal: AbortSignal, year: number, month: number): Promise<MonthlySummary>;
}

export class SheetNotFoundError extends Error {
  override name = 'SheetNotFoundError';
}

export class AmbiguousSheetsError extends Error {
  override name = 'AmbiguousSheetsError';
}
