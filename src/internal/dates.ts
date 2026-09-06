/**
 * Strict-ish ISO date / datetime parsing for deterministic engines.
 *
 * Date-only values are interpreted as UTC midnight. Date-times use
 * `Date.parse` on ISO-8601 strings (including a trailing Z). Invalid
 * inputs return null so callers can skip rather than throw.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** Parse a strict YYYY-MM-DD date to UTC millis; null when invalid. */
export function parseIsoDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return ms;
}

/**
 * Parse an ISO date or date-time to UTC millis. Accepts YYYY-MM-DD or a
 * Date.parse-able ISO-8601 timestamp.
 */
export function parseIsoDateTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const asDate = parseIsoDate(s);
  if (asDate !== null) return asDate;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

export function hoursBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / HOUR_MS;
}

/** Round to `decimals` places with ordinary half-away-from-zero (display only). */
export function roundTo(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
