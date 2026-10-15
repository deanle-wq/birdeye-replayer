/** A lookup the workspace already shows: a token board, a wallet or a chart. */
export interface LoadedLookup {
  address: string;
  /** Sample data never blocks a real lookup of the same address. */
  demo?: boolean;
  /** False while background work for it (the leading-wallet audit) is unfinished or was cut short. */
  settled?: boolean;
}

/**
 * Whether looking `input` up again would only repeat what is on screen.
 * Repeats re-spend compute units and trip the per-minute rate limit, so the
 * submit button locks and in-app links switch views instead of refetching.
 */
export function sameLookup(input: string, loaded: LoadedLookup | null | undefined): boolean {
  if (!loaded || loaded.demo || loaded.settled === false) return false;
  return input.trim() === loaded.address;
}

/** A small time-boxed cache for per-token context reused across video opens. */
export class TimedCache<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { at: this.now(), value });
  }
}
