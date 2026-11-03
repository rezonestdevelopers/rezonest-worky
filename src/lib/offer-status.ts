export type OfferStatus = "DRAFT" | "SENT" | "ON_HOLD" | "ACCEPTED" | "REJECTED" | "EXPIRED";

const MOVES: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["ON_HOLD", "ACCEPTED", "REJECTED", "EXPIRED"],
  ON_HOLD: ["SENT", "ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

/**
 * The offer status flow. Returns a message when a move isn't allowed, otherwise null.
 * Sent and On Hold need a follow-up date, so an open offer is never forgotten.
 */
export function statusChangeError(input: {
  from: OfferStatus;
  to: OfferStatus;
  todayKey: string;
  validUntilKey: string;
  followUpKey?: string | null;
  rejectReason?: string | null;
  acceptedByName?: string | null;
}): string | null {
  const { from, to } = input;
  if (from === to) return "The offer is already in this status.";
  if (!MOVES[from].includes(to)) return `An offer that is ${from.toLowerCase().replace("_", " ")} can't be changed to ${to.toLowerCase().replace("_", " ")}.`;
  if (to === "SENT" || to === "ON_HOLD") {
    if (!input.followUpKey) return "Please choose a follow-up date.";
    if (input.followUpKey < input.todayKey) return "The follow-up date can't be in the past.";
  }
  if (to === "SENT" && input.validUntilKey < input.todayKey) return "This offer's validity has passed. Change the valid-until date first.";
  if (to === "REJECTED" && (input.rejectReason?.trim().length ?? 0) < 3) return "Please enter the reason it was rejected.";
  if (to === "ACCEPTED" && (input.acceptedByName?.trim().length ?? 0) < 2) return "Please enter who accepted the offer.";
  return null;
}

/** Only drafts are edited directly. Anything already sent changes through a new version. */
export const canEdit = (status: OfferStatus) => status === "DRAFT";
export const canRevise = (status: OfferStatus) => status === "SENT" || status === "ON_HOLD" || status === "REJECTED" || status === "EXPIRED";
/** Offers the client can still respond to. */
export const isOpen = (status: OfferStatus) => status === "SENT" || status === "ON_HOLD";

/** Can the client accept or ask for changes through the public link right now? */
export function publicResponseError(input: {
  status: OfferStatus;
  todayKey: string;
  validUntilKey: string;
  revoked: boolean;
  linkExpired: boolean;
}): string | null {
  if (input.revoked) return "This link is no longer valid. Please ask us for the latest offer.";
  if (input.status === "ACCEPTED") return "This offer has already been accepted.";
  if (!isOpen(input.status)) return "This offer is no longer open. Please contact us for an updated offer.";
  if (input.linkExpired || input.validUntilKey < input.todayKey) return "This offer's validity has ended. Please contact us for an updated offer.";
  return null;
}
