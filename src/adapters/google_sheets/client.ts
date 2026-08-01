import {
  type BatchUpdateRequest,
  SheetNotFoundError,
  type SheetsAPI,
  type Spreadsheet,
} from './types.ts';
import type { ServiceAccountTokenProvider } from './auth.ts';

export class GoogleSheetsHTTPClient implements SheetsAPI {
  readonly #tokenProvider: ServiceAccountTokenProvider;
  readonly #baseURL: string;
  readonly #fetcher: typeof fetch;
  readonly #requestTimeoutMs: number;

  constructor(
    tokenProvider: ServiceAccountTokenProvider,
    options: { baseURL?: string; fetcher?: typeof fetch; requestTimeoutMs?: number } = {},
  ) {
    this.#tokenProvider = tokenProvider;
    this.#baseURL = (options.baseURL ?? 'https://sheets.googleapis.com/v4').replace(/\/+$/u, '');
    this.#fetcher = options.fetcher ?? fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : 30_000;
  }

  async getSpreadsheet(signal: AbortSignal, spreadsheetId: string): Promise<Spreadsheet> {
    const data = await this.#request(
      signal,
      `/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false`,
    );
    const rawSheets = data.sheets;
    if (!Array.isArray(rawSheets)) return { sheets: [] };
    return {
      sheets: rawSheets.flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const properties = (raw as { properties?: unknown }).properties;
        if (typeof properties !== 'object' || properties === null) return [];
        const value = properties as { sheetId?: unknown; title?: unknown; hidden?: unknown };
        return typeof value.sheetId === 'number' && typeof value.title === 'string'
          ? [{ id: value.sheetId, title: value.title, hidden: value.hidden === true }]
          : [];
      }),
    };
  }

  async getValues(signal: AbortSignal, spreadsheetId: string, range: string): Promise<string[][]> {
    const path = `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${
      encodeURIComponent(range)
    }`;
    try {
      const data = await this.#request(signal, path);
      if (!Array.isArray(data.values)) return [];
      return data.values.map((row) => Array.isArray(row) ? row.map((value) => String(value)) : []);
    } catch (error) {
      if (
        error instanceof GoogleHTTPError && error.status === 400 &&
        /unable to parse range/iu.test(error.message)
      ) {
        throw new SheetNotFoundError('sheet not found');
      }
      throw error;
    }
  }

  async batchUpdate(
    signal: AbortSignal,
    spreadsheetId: string,
    request: BatchUpdateRequest,
  ): Promise<void> {
    await this.#request(signal, `/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: request.requests.map(toGoogleRequest) }),
    });
  }

  async #request(
    signal: AbortSignal,
    path: string,
    options: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const token = await this.#tokenProvider.accessToken(signal);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.#requestTimeoutMs);
    const requestSignal = AbortSignal.any([signal, timeoutController.signal]);
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#baseURL}${path}`, {
        ...options,
        signal: requestSignal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch (error) {
      throw new Error(`Google Sheets request failed: ${String(error)}`, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      let message = '';
      try {
        const body = await response.json() as { error?: { message?: unknown } };
        if (typeof body.error?.message === 'string') message = body.error.message;
      } catch {
        // Keep HTTP errors generic if the response is not JSON.
      }
      throw new GoogleHTTPError(response.status, message);
    }
    if (response.status === 204) return {};
    const data = await response.json();
    return typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  }
}

export class GoogleHTTPError extends Error {
  constructor(readonly status: number, message: string) {
    super(`Google Sheets HTTP status ${status}${message ? `: ${message}` : ''}`);
    this.name = 'GoogleHTTPError';
  }
}

function toGoogleRequest(request: BatchUpdateRequest['requests'][number]): Record<string, unknown> {
  if (request.addSheet) {
    return {
      addSheet: {
        properties: { title: request.addSheet.title, hidden: request.addSheet.hidden === true },
      },
    };
  }
  if (request.updateSheetProperties) {
    return {
      updateSheetProperties: {
        properties: {
          sheetId: request.updateSheetProperties.sheetId,
          hidden: request.updateSheetProperties.hidden,
        },
        fields: 'hidden',
      },
    };
  }
  if (request.appendCells) {
    return {
      appendCells: {
        sheetId: request.appendCells.sheetId,
        rows: request.appendCells.values.map((row) => ({
          values: row.map((value) => ({ userEnteredValue: { stringValue: value } })),
        })),
        fields: 'userEnteredValue',
      },
    };
  }
  return {};
}
