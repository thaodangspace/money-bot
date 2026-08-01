import { type Clock, randomToken } from '../shared/runtime.ts';
import type { Transaction } from '../domain/transaction.ts';

export interface PendingImage {
  transactions: Transaction[];
  updateId: number;
  expiresAt: number;
}
interface PendingEntry extends PendingImage {
  confirming: boolean;
}

export class ImagePendingStore {
  readonly #entries = new Map<string, PendingEntry>();
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #token: (byteLength: number) => string;

  constructor(
    clock: Clock,
    options: { ttlMs?: number; maxEntries?: number; token?: (byteLength: number) => string } = {},
  ) {
    this.#clock = clock;
    this.#ttlMs = options.ttlMs ?? 10 * 60 * 1_000;
    this.#maxEntries = options.maxEntries ?? 16;
    this.#token = options.token ?? randomToken;
  }

  add(transactions: Transaction[], updateId: number): string | undefined {
    this.evictExpired();
    if (this.#entries.size >= this.#maxEntries) return undefined;
    let token = '';
    for (let attempts = 0; attempts < 4; attempts++) {
      token = this.#token(18);
      if (!this.#entries.has(token)) break;
    }
    if (!token || this.#entries.has(token)) return undefined;
    this.#entries.set(token, {
      transactions: [...transactions],
      updateId,
      expiresAt: this.#clock.now().getTime() + this.#ttlMs,
      confirming: false,
    });
    return token;
  }

  beginConfirmation(token: string): PendingImage | undefined {
    this.evictExpired();
    const entry = this.#entries.get(token);
    if (!entry || entry.confirming) return undefined;
    entry.confirming = true;
    return {
      transactions: [...entry.transactions],
      updateId: entry.updateId,
      expiresAt: entry.expiresAt,
    };
  }
  releaseConfirmation(token: string): void {
    const entry = this.#entries.get(token);
    if (entry) entry.confirming = false;
  }
  complete(token: string): void {
    this.#entries.delete(token);
  }
  cancel(token: string): boolean {
    this.evictExpired();
    return this.#entries.delete(token);
  }
  get size(): number {
    this.evictExpired();
    return this.#entries.size;
  }
  private evictExpired(): void {
    const now = this.#clock.now().getTime();
    for (const [token, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(token);
    }
  }
}
