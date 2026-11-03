import crypto from "node:crypto";

/**
 * Tokens for no-login links. The token is worked out from the link's id and a server secret, so
 * the same link can be shared again later without storing it. The database keeps only a hash, so
 * a copy of the database alone can't produce a working link.
 * Changing AUTH_SECRET makes existing client links stop working.
 */
export function publicToken(linkId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return crypto.createHmac("sha256", secret).update(`public-link:${linkId}`).digest("base64url");
}

export function hashPublicToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** A token is 43 URL-safe characters. Anything else is rejected before touching the database. */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function publicOfferUrl(linkId: string): string {
  return `${process.env.APP_URL ?? "http://localhost:3000"}/p/offer/${publicToken(linkId)}`;
}
