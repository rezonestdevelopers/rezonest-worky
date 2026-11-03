export type LeadStage = "NEW" | "CONTACTED" | "REQUIREMENT_DISCUSSED" | "OFFER_SENT" | "WON" | "LOST";

export const LEAD_STAGES: LeadStage[] = ["NEW", "CONTACTED", "REQUIREMENT_DISCUSSED", "OFFER_SENT", "WON", "LOST"];

/**
 * Rules for moving a lead between stages. Returns a message when the move is
 * not allowed, otherwise null.
 * - Won only happens through "Convert to Client", so every Won lead has a client.
 * - A converted lead stays Won.
 * - Lost needs a reason. A Lost lead can be reopened.
 */
export function stageChangeError(input: {
  from: LeadStage;
  to: LeadStage;
  converted: boolean;
  lostReason?: string | null;
}): string | null {
  if (input.from === input.to) return "The lead is already in this stage.";
  if (input.converted) return "This lead has been converted to a client, so its stage can't change.";
  if (input.to === "WON") return "Use “Convert to Client” to mark a lead as Won.";
  if (input.to === "LOST" && (input.lostReason?.trim().length ?? 0) < 3) return "Please enter the reason this lead was lost.";
  return null;
}
