export const CONTENT_FORMATS = ["STATIC_POST", "CAROUSEL", "REEL", "STORY", "VIDEO"] as const;
export const SOCIAL_PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X", "OTHER"] as const;
export const DESIGN_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "READY"] as const;
export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "CHANGES_REQUESTED"] as const;

const PLATFORM_LABEL: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", YOUTUBE: "YouTube", X: "X", OTHER: "Other" };
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

/** How long a client's approval link keeps working. */
export const CONTENT_LINK_DAYS = 30;

/** Why this link can't be used, or null if it can. */
export function contentLinkError(link: { revokedAt: Date | null; expiresAt: Date }, now = new Date()): string | null {
  if (link.revokedAt) return "This link has been withdrawn. Please ask us for a new one.";
  if (link.expiresAt < now) return "This link has expired. Please ask us for a new one.";
  return null;
}

/** Why the client can't answer on this item, or null if they can. Only something awaiting approval can be answered. */
export function contentResponseError(item: { approvalStatus: string; publishedAt: Date | null; archivedAt: Date | null }): string | null {
  if (item.archivedAt) return "This item is no longer part of the calendar.";
  if (item.publishedAt) return "This has already been published.";
  if (item.approvalStatus === "APPROVED") return "This has already been approved.";
  if (item.approvalStatus === "CHANGES_REQUESTED") return "We already have your changes for this one and will share it again.";
  return null;
}

/** Changing what the client approved means they have to see it again. */
export function approvalNeedsReset(before: { topic: string; caption: string | null; creativeUrl: string | null }, after: { topic: string; caption: string | null; creativeUrl: string | null }): boolean {
  return before.topic !== after.topic || (before.caption ?? "") !== (after.caption ?? "") || (before.creativeUrl ?? "") !== (after.creativeUrl ?? "");
}

export type DeliveryRow = { clientId: string; client: string; format: string | null; delivered: boolean };
export type DeliverySummary = { clientId: string; client: string; committed: number; delivered: number; formats: { format: string; committed: number; delivered: number }[] };

/** Committed vs delivered per client and format: the "8/12 posts, 5/8 reels" line. */
export function summariseDelivery(rows: DeliveryRow[]): DeliverySummary[] {
  const clients = new Map<string, DeliverySummary>();
  for (const r of rows) {
    const c = clients.get(r.clientId) ?? { clientId: r.clientId, client: r.client, committed: 0, delivered: 0, formats: [] };
    const key = r.format ?? "OTHER";
    let f = c.formats.find((x) => x.format === key);
    if (!f) c.formats.push((f = { format: key, committed: 0, delivered: 0 }));
    f.committed++;
    c.committed++;
    if (r.delivered) {
      f.delivered++;
      c.delivered++;
    }
    clients.set(r.clientId, c);
  }
  return [...clients.values()].sort((a, b) => a.client.localeCompare(b.client));
}
