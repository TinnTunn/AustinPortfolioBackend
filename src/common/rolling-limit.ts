/**
 * A tiny in-memory sliding-window counter for *global* caps (across all IPs),
 * on top of the per-IP throttler. It protects shared resources — the Gemini
 * quota, the email quota, the database — from distributed abuse. The API runs
 * as a single instance, so in-memory is enough; a restart simply resets it.
 */
export class RollingLimit {
  private hits: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  /** Records one use and returns true, or returns false if the cap is reached. */
  take(): boolean {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}
