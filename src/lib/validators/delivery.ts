import { z } from "zod";
import { APPROVAL_STATUSES, CONTENT_FORMATS, DESIGN_STATUSES, SOCIAL_PLATFORMS } from "@/lib/content-plan";
import { ASSET_KINDS, looksLikePassword } from "@/lib/renewals";
import { safeExternalUrl } from "@/lib/safe-url";
import { isValidDateKey, moneyString, optionalDateKey, optionalId, optionalMoney, optionalText } from "./common";

const dateKey = z.string().trim().refine(isValidDateKey, "Enter a valid date");
const id = z.string().min(1).max(60);
const clientId = z.string().min(1, "Choose a client").max(60);

const optionalLink = z
  .string()
  .trim()
  .max(500, "That link is too long")
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null)
  .refine((v) => v === null || !!safeExternalUrl(v), "Enter a valid link")
  .transform((v) => (v ? safeExternalUrl(v) : null));

// ─── Content calendar ────────────────────────────────────────────────────────

export const contentItemSchema = z.object({
  clientId,
  projectId: optionalId,
  format: z.enum(CONTENT_FORMATS),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1, "Choose at least one platform"),
  topic: z.string().trim().min(2, "What is this post about?").max(200),
  caption: optionalText(5000),
  publishDate: dateKey,
});
export type ContentItemInput = z.input<typeof contentItemSchema>;
export type ContentItemData = z.output<typeof contentItemSchema>;

export const designStatusSchema = z.object({ itemId: id, designStatus: z.enum(DESIGN_STATUSES) });
export const creativeLinkSchema = z.object({ itemId: id, creativeUrl: optionalLink });
export const publishSchema = z.object({ itemId: id, publishedLink: optionalLink });

export const contentResponseSchema = z
  .object({
    token: z.string().min(1).max(100),
    itemId: id,
    decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
    name: z.string().trim().min(2, "Please enter your name").max(120),
    comment: optionalText(2000),
  })
  .superRefine((r, ctx) => {
    if (r.decision === "CHANGES_REQUESTED" && (r.comment?.length ?? 0) < 3) ctx.addIssue({ code: "custom", path: ["comment"], message: "Please tell us what you'd like changed" });
  });

export const handApprovalSchema = z.object({ itemId: id, comment: z.string().trim().min(3, "Say how the client approved it, e.g. on WhatsApp").max(500) });
export const contentMonthSchema = z.object({ clientId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month") });

export { APPROVAL_STATUSES };

// ─── Meta Ads ────────────────────────────────────────────────────────────────

export const CAMPAIGN_STATUSES = ["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"] as const;

export const campaignSchema = z
  .object({
    clientId,
    projectId: optionalId,
    name: z.string().trim().min(2, "Name the campaign").max(160),
    objective: optionalText(80),
    status: z.enum(CAMPAIGN_STATUSES),
    startDate: dateKey,
    endDate: optionalDateKey,
    plannedBudget: moneyString.refine((v) => Number(v) > 0, "Enter the client's budget"),
  })
  .superRefine((c, ctx) => {
    if (c.endDate && c.endDate < c.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date can't be before the start date" });
  });
export type CampaignInput = z.input<typeof campaignSchema>;
export type CampaignData = z.output<typeof campaignSchema>;

const count = (label: string) => z.coerce.number({ error: `${label} must be a whole number` }).int(`${label} must be a whole number`).min(0, `${label} can't be negative`).max(2_000_000_000);

export const spendEntrySchema = z
  .object({
    campaignId: id,
    periodStart: dateKey,
    periodEnd: dateKey,
    spend: moneyString,
    impressions: count("Impressions"),
    clicks: count("Clicks"),
    leads: count("Leads"),
    conversionValue: optionalMoney.transform((v) => v ?? "0"),
  })
  .superRefine((e, ctx) => {
    if (e.periodEnd < e.periodStart) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "The end date can't be before the start date" });
    if (e.clicks > e.impressions) ctx.addIssue({ code: "custom", path: ["clicks"], message: "Clicks can't be more than impressions" });
  });
export type SpendEntryInput = z.input<typeof spendEntrySchema>;
export type SpendEntryData = z.output<typeof spendEntrySchema>;

// ─── Domains and hosting ─────────────────────────────────────────────────────

const noPasswords = (max: number) =>
  optionalText(max).refine((v) => !looksLikePassword(v), "Don't write passwords here. Just say where they're kept.");

export const assetSchema = z
  .object({
    clientId,
    kind: z.enum(ASSET_KINDS),
    name: z.string().trim().min(2, "Enter the name").max(160),
    provider: optionalText(120),
    plan: optionalText(120),
    purchaseDate: optionalDateKey,
    expiryDate: dateKey,
    emailAccounts: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => String(v ?? "").trim())
      .refine((v) => v === "" || /^\d{1,5}$/.test(v), "Enter a whole number")
      .transform((v) => (v ? Number(v) : null)),
    costPrice: moneyString,
    renewalPrice: moneyString,
    autoRenew: z.boolean(),
    credentialsLocation: noPasswords(300),
    notes: noPasswords(2000),
  })
  .superRefine((a, ctx) => {
    if (a.kind === "DOMAIN" && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(a.name)) ctx.addIssue({ code: "custom", path: ["name"], message: "Enter a domain like example.com" });
    if (a.purchaseDate && a.purchaseDate > a.expiryDate) ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "The expiry date can't be before the purchase date" });
  });
export type AssetInput = z.input<typeof assetSchema>;
export type AssetData = z.output<typeof assetSchema>;

export const renewAssetSchema = z.object({ assetId: id, newExpiry: dateKey });
