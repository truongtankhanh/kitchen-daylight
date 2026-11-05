import { Clock } from './clock.js';

/**
 * A clock that stands still until a spec moves it. For specs only: provide it with
 * `{ provide: Clock, useValue: new FixedClock('2026-10-27T03:00:00Z') }` or pass it directly.
 */
export class FixedClock extends Clock {
  private current: number;

  constructor(instant: Date | string) {
    super();
    this.current = FixedClock.toMillis(instant);
  }

  /** A copy, so a caller cannot move the clock by mutating the result. */
  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string): void {
    this.current = FixedClock.toMillis(instant);
  }

  /** Moves the clock forward (or back, with a negative value) by `milliseconds`. */
  advance(milliseconds: number): void {
    this.current += milliseconds;
  }

  private static toMillis(instant: Date | string): number {
    const millis = new Date(instant).getTime();
    if (Number.isNaN(millis)) {
      throw new RangeError('FixedClock needs a valid instant.');
    }
    return millis;
  }
}
