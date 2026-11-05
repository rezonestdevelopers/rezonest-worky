/**
 * Simple in-memory sliding-window rate limiter.
 * Good for a single server (VPS). On multi-instance hosting each instance has
 * its own window — the DB account lockout (5 failures → 15 min) still applies
 * everywhere. See docs/DECISIONS.md.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function clientIp(h: Headers): string {
  // Set by our own proxy, so it can be trusted. In a forwarded list, only the last entry was added
  // by a proxy we run: anything before it could have been typed in by the visitor to dodge a limit.
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  return h.get("x-forwarded-for")?.split(",").map((p) => p.trim()).filter(Boolean).at(-1) || "unknown";
}
