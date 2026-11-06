/** Grace window of ADR-0008 #6: a just-used token re-presented within it gets the same successor. */
export const REFRESH_GRACE_WINDOW_MS = 10_000;

interface Entry<T> {
  readonly promise: Promise<T>;
  /** When the rotation succeeded; `null` while it is in flight. */
  settledAt: number | null;
  familyId: string | null;
}

/**
 * The in-process single-flight map of decision 0008 section 2, option (a): presented token hash →
 * the promise of its rotation. A second presentation while the first is in flight, or within
 * `REFRESH_GRACE_WINDOW_MS` after it succeeded, gets the same promise and so the same successor.
 * A failed rotation is removed at once. Valid while one API instance runs; a restart empties it
 * (the restart rule of section 2). Keys are hashes, never raw tokens; nothing is logged.
 */
export class RefreshGrace<T extends { readonly familyId: string }> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly windowMs: number = REFRESH_GRACE_WINDOW_MS) {}

  /** The rotation of `key` in flight or settled within the window, else `undefined`. */
  get(key: string, nowMs: number): Promise<T> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.settledAt !== null && nowMs - entry.settledAt > this.windowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.promise;
  }

  /**
   * Runs `work` as the single flight of `key`. The entry is stored before `work` can yield, so a
   * concurrent call finds it. `now` is read when the rotation settles (the start of the window).
   */
  start(key: string, work: () => Promise<T>, now: () => number): Promise<T> {
    this.sweep(now());
    const entry: Entry<T> = {
      promise: work().then(
        (result) => {
          entry.settledAt = now();
          entry.familyId = result.familyId;
          return result;
        },
        (error: unknown) => {
          if (this.entries.get(key) === entry) {
            this.entries.delete(key);
          }
          throw error;
        },
      ),
      settledAt: null,
      familyId: null,
    };
    this.entries.set(key, entry);
    return entry.promise;
  }

  /** Revoking a family drops its entries, so no grace answer outlives the revocation. */
  forgetFamily(familyId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.familyId === familyId) {
        this.entries.delete(key);
      }
    }
  }

  /** Entries held, for specs. */
  get size(): number {
    return this.entries.size;
  }

  /** Drops settled entries older than the window; the map holds at most the last 10 s. */
  private sweep(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.settledAt !== null && nowMs - entry.settledAt > this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}
