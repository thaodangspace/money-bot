import { type Clock, randomToken } from '../shared/runtime.ts';
import type { Transaction } from '../domain/transaction.ts';

export interface PendingImage {
  transactions: Transaction[];
  updateId: number;
  expiresAt: number;
}
export interface PendingImageStore {
  add(
    signal: AbortSignal,
    transactions: Transaction[],
    updateId: number,
  ): Promise<string | undefined>;
  getConfirmable(signal: AbortSignal, token: string): Promise<PendingImage | undefined>;
  complete(signal: AbortSignal, token: string): Promise<void>;
  cancel(signal: AbortSignal, token: string): Promise<boolean>;
  countActive(signal: AbortSignal): Promise<number>;
  release?(token: string): void;
}
interface Entry extends PendingImage {
  confirming: boolean;
}

/** Test-only process-local implementation. Production must use the Sheets implementation. */
export class InMemoryPendingImageStore implements PendingImageStore {
  readonly #entries = new Map<string, Entry>();
  constructor(
    readonly clock: Clock,
    readonly options: { ttlMs?: number; maxEntries?: number; token?: (bytes: number) => string } =
      {},
  ) {}
  add(
    _signal: AbortSignal,
    transactions: Transaction[],
    updateId: number,
  ): Promise<string | undefined> {
    this.evict();
    const max = this.options.maxEntries ?? 16;
    if (this.#entries.size >= max) return Promise.resolve(undefined);
    let token = '';
    for (let i = 0; i < 4; i++) {
      token = (this.options.token ?? randomToken)(18);
      if (!this.#entries.has(token)) break;
    }
    if (!token || this.#entries.has(token)) return Promise.resolve(undefined);
    this.#entries.set(token, {
      transactions: [...transactions],
      updateId,
      expiresAt: this.clock.now().getTime() + (this.options.ttlMs ?? 600_000),
      confirming: false,
    });
    return Promise.resolve(token);
  }
  getConfirmable(_signal: AbortSignal, token: string): Promise<PendingImage | undefined> {
    this.evict();
    const entry = this.#entries.get(token);
    if (!entry || entry.confirming) return Promise.resolve(undefined);
    entry.confirming = true;
    return Promise.resolve({
      transactions: [...entry.transactions],
      updateId: entry.updateId,
      expiresAt: entry.expiresAt,
    });
  }
  complete(_signal: AbortSignal, token: string): Promise<void> {
    this.#entries.delete(token);
    return Promise.resolve();
  }
  cancel(_signal: AbortSignal, token: string): Promise<boolean> {
    this.evict();
    return Promise.resolve(this.#entries.delete(token));
  }
  countActive(): Promise<number> {
    this.evict();
    return Promise.resolve(this.#entries.size);
  }
  release(token: string): void {
    const entry = this.#entries.get(token);
    if (entry) entry.confirming = false;
  }
  private evict(): void {
    const now = this.clock.now().getTime();
    for (const [token, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(token);
    }
  }
}

/** Backwards-compatible name for tests and fakes; never instantiate this in runtime composition. */
export class ImagePendingStore extends InMemoryPendingImageStore {}
