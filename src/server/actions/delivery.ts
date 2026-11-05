"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/server/action-guard";
import { invalid, type ActionResult } from "@/lib/action-result";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { CONTENT_LINK_DAYS } from "@/lib/content-plan";
import { formatMonthKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { renderTemplate } from "@/lib/email-templates";
import { sendMail } from "@/lib/mailer";
import { getTemplate } from "@/server/services/email-templates";
import { publicToken } from "@/lib/public-token";
import { putFile, sniffImage } from "@/lib/storage";
import {
  assetSchema,
  campaignSchema,
  contentItemSchema,
  contentMonthSchema,
  creativeLinkSchema,
  designStatusSchema,
  handApprovalSchema,
  publishSchema,
  renewAssetSchema,
  spendEntrySchema,
  type AssetInput,
  type CampaignInput,
  type ContentItemInput,
  type SpendEntryInput,
} from "@/lib/validators/delivery";
import { commitAdImport, MAX_AD_IMPORT_BYTES, MAX_AD_IMPORT_ROWS, previewAdImport, removeSpendEntry, saveCampaign, saveSpendEntry, setCampaignArchived } from "@/server/services/ads";
import {
  approveByHand,
  ensureContentLink,
  markPublished,
  reopenForApproval,
  revokeContentLink,
  saveContentItem,
  setContentArchived,
  setCreativeFile,
  setCreativeLink,
  setDesignStatus,
  undoPublished,
} from "@/server/services/content";
import { renewAsset, saveAsset, setAssetArchived } from "@/server/services/renewals";
import { BusinessError } from "@/server/services/shared";
import { loadViewer } from "@/server/services/tasks";
import type { AdImportRow } from "@/lib/ad-metrics";

const CHANGED = "The client will need to approve this again, because what they approved has changed.";

// ─── Content calendar ────────────────────────────────────────────────────────

function refreshContent(id?: string) {
  revalidatePath("/content");
  if (id) revalidatePath(`/content/${id}`);
}

export async function saveContentItemAction(id: string | null, input: ContentItemInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = contentItemSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { item, approvalReset } = await saveContentItem(db, id, parsed.data, user.id);
    refreshContent(item.id);
    return { ok: true, id: item.id, message: approvalReset ? `Saved. ${CHANGED}` : "Saved." };
  });
}

export async function setDesignStatusAction(input: z.input<typeof designStatusSchema>): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = designStatusSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await setDesignStatus(db, { ...parsed.data, viewer: await loadViewer(db, user) });
    refreshContent(parsed.data.itemId);
    return { ok: true, message: "Design status updated." };
  });
}

const CREATIVE_MAX = 5 * 1024 * 1024;

export async function uploadCreativeAction(formData: FormData): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const itemId = String(formData.get("itemId") ?? "");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Please choose a file." };
    if (file.size > CREATIVE_MAX) return { ok: false, error: "Files must be 5 MB or smaller. For reels and videos, paste a Drive or YouTube link instead." };
    const buf = Buffer.from(await file.arrayBuffer());
    const image = sniffImage(buf);
    const type = image ? { ext: image, mime: image === "jpg" ? "image/jpeg" : `image/${image}` } : buf.subarray(0, 5).toString() === "%PDF-" ? { ext: "pdf", mime: "application/pdf" } : null;
    if (!type) return { ok: false, error: "Only PNG, JPG, WebP and PDF files can be uploaded here. For reels and videos, paste a link instead." };
    const viewer = await loadViewer(db, user);
    const storageKey = `private/creatives/${crypto.randomUUID()}.${type.ext}`;
    await putFile(storageKey, buf, type.mime);
    const { approvalReset } = await setCreativeFile(db, { itemId, name: file.name.slice(0, 200), storageKey, mimeType: type.mime, sizeBytes: file.size, viewer });
    refreshContent(itemId);
    return { ok: true, message: approvalReset ? `Creative added. ${CHANGED}` : "Creative added." };
  });
}

export async function setCreativeLinkAction(input: z.input<typeof creativeLinkSchema>): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = creativeLinkSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { approvalReset } = await setCreativeLink(db, { ...parsed.data, viewer: await loadViewer(db, user) });
    refreshContent(parsed.data.itemId);
    return { ok: true, message: approvalReset ? `Link saved. ${CHANGED}` : "Link saved." };
  });
}

export async function markPublishedAction(input: z.input<typeof publishSchema>): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { closed } = await markPublished(db, { ...parsed.data, viewer: await loadViewer(db, user) });
    refreshContent(parsed.data.itemId);
    revalidatePath("/tasks");
    return { ok: true, message: closed ? `Marked as published, and ${closed} open task${closed === 1 ? " was" : "s were"} finished.` : "Marked as published." };
  });
}

export async function undoPublishedAction(itemId: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await undoPublished(db, itemId, user.id);
    refreshContent(itemId);
    return { ok: true, message: "No longer marked as published." };
  });
}

export async function reopenForApprovalAction(itemId: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await reopenForApproval(db, itemId, user.id);
    refreshContent(itemId);
    return { ok: true, message: "Ready for the client to look at again." };
  });
}

export async function approveByHandAction(input: z.input<typeof handApprovalSchema>): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = handApprovalSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await approveByHand(db, { ...parsed.data, actorId: user.id, actorName: user.name });
    refreshContent(parsed.data.itemId);
    return { ok: true, message: "Recorded as approved." };
  });
}

export async function setContentArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await setContentArchived(db, id, archived, user.id);
    refreshContent(id);
    return { ok: true, message: archived ? "Archived." : "Restored." };
  });
}

export type ContentShare = { ok: true; link: string; whatsapp: string; phone: string | null; email: string | null; emailSent?: boolean } | { ok: false; error: string };

async function shareDetails(clientId: string, month: string, actorId: string) {
  const link = await ensureContentLink(db, { clientId, month, actorId });
  const [client, settings] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, include: { contacts: { where: { isPrimary: true }, take: 1 } } }),
    db.settings.findUnique({ where: { id: "agency" }, select: { agencyName: true } }),
  ]);
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/p/content/${publicToken(link.id)}`;
  const contact = client.contacts[0];
  const agency = settings?.agencyName ?? "Rezonest";
  const message = renderTemplate(await getTemplate(db, "content_approval"), {
    contactName: contact?.name ?? client.companyName,
    companyName: client.companyName,
    month: formatMonthKey(month),
    link: url,
    linkDays: String(CONTENT_LINK_DAYS),
    agencyName: agency,
  });
  return {
    url,
    phone: contact?.whatsapp ?? contact?.phone ?? client.whatsapp ?? client.phone ?? null,
    email: contact?.email ?? client.email ?? null,
    whatsapp: message.whatsapp ?? message.text,
    subject: message.subject,
    text: message.text,
  };
}

/** Gets the client's link, creating it the first time. Nothing is sent. */
export async function shareContentLinkAction(input: z.input<typeof contentMonthSchema>): Promise<ContentShare> {
  try {
    const user = await assertPermission("work.manage");
    const parsed = contentMonthSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please choose a client and month." };
    const s = await shareDetails(parsed.data.clientId, parsed.data.month, user.id);
    refreshContent();
    return { ok: true, link: s.url, whatsapp: s.whatsapp, phone: s.phone, email: s.email };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof BusinessError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function emailContentLinkAction(input: z.input<typeof contentMonthSchema> & { to: string }): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = contentMonthSchema.safeParse(input);
    const to = z.string().trim().email().safeParse(input.to);
    if (!parsed.success || !to.success) return { ok: false, error: "Please enter a valid email address." };
    const s = await shareDetails(parsed.data.clientId, parsed.data.month, user.id);
    const sent = await sendMail({ to: to.data, subject: s.subject, text: s.text, entityType: "Client", entityId: parsed.data.clientId });
    refreshContent();
    return sent.ok ? { ok: true, message: `Emailed to ${to.data}.` } : { ok: false, error: "The email couldn't be sent. You can copy the link and share it yourself." };
  });
}

export async function revokeContentLinkAction(linkId: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await revokeContentLink(db, linkId, user.id);
    refreshContent();
    return { ok: true, message: "Link withdrawn. It no longer works." };
  });
}

// ─── Meta Ads ────────────────────────────────────────────────────────────────

function refreshAds(id?: string) {
  revalidatePath("/ads");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/ads/${id}`);
}

export async function saveCampaignAction(id: string | null, input: CampaignInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = campaignSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const campaign = await saveCampaign(db, id, parsed.data, user.id);
    refreshAds(campaign.id);
    return { ok: true, id: campaign.id, message: "Campaign saved." };
  });
}

export async function setCampaignArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await setCampaignArchived(db, id, archived, user.id);
    refreshAds(id);
    return { ok: true, message: archived ? "Campaign archived." : "Campaign restored." };
  });
}

export async function saveSpendEntryAction(id: string | null, input: SpendEntryInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = spendEntrySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveSpendEntry(db, id, parsed.data, user.id);
    refreshAds(parsed.data.campaignId);
    return { ok: true, message: "Results saved." };
  });
}

export async function removeSpendEntryAction(id: string, campaignId: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await removeSpendEntry(db, id, user.id);
    refreshAds(campaignId);
    return { ok: true, message: "Entry removed from the totals." };
  });
}

export type AdPreview =
  | { ok: true; rows: { rowNumber: number; cells: string[] }[]; columns: Record<string, number>; ignored: string[]; leadsFromResults: boolean; analysed: AdImportRow[] }
  | { ok: false; error: string };

/** Step 1: read the report and show what would happen. Nothing is saved. */
export async function previewAdImportAction(formData: FormData): Promise<AdPreview> {
  try {
    await assertPermission("work.manage");
    const clientId = String(formData.get("clientId") ?? "");
    const file = formData.get("file");
    if (!clientId) return { ok: false, error: "Please choose the client first." };
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Please choose a file." };
    if (file.size > MAX_AD_IMPORT_BYTES) return { ok: false, error: "The file must be 5 MB or smaller." };
    return { ok: true, ...(await previewAdImport(db, { clientId, buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name })) };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof BusinessError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "This file couldn't be read. Please check it and try again." };
  }
}

const commitSchema = z.object({
  clientId: z.string().min(1).max(60),
  rows: z.array(z.object({ rowNumber: z.number().int().positive(), cells: z.array(z.string().max(1000)).max(200) })).min(1).max(MAX_AD_IMPORT_ROWS),
  columns: z.record(z.number().int().min(0).max(200)),
});

/** Step 2: save the rows that passed. Every row is checked again on the server. */
export async function commitAdImportAction(input: z.input<typeof commitSchema>): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = commitSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "The upload wasn't valid. Please choose the file again." };
    const { imported, skipped } = await commitAdImport(db, { ...parsed.data, actorId: user.id });
    refreshAds();
    return { ok: true, message: `${imported} row${imported === 1 ? "" : "s"} added${skipped ? `, ${skipped} skipped` : ""}.` };
  });
}

// ─── Domains and hosting ─────────────────────────────────────────────────────

function refreshRenewals(id?: string) {
  revalidatePath("/renewals");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/renewals/${id}`);
}

export async function saveAssetAction(id: string | null, input: AssetInput): Promise<ActionResult> {
  return runAction("finance.manage", async (user) => {
    const parsed = assetSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const asset = await saveAsset(db, id, parsed.data, user.id);
    refreshRenewals(asset.id);
    return { ok: true, id: asset.id, message: "Saved." };
  });
}

export async function renewAssetAction(input: z.input<typeof renewAssetSchema>): Promise<ActionResult> {
  return runAction("finance.manage", async (user) => {
    const parsed = renewAssetSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await renewAsset(db, { ...parsed.data, actorId: user.id });
    refreshRenewals(parsed.data.assetId);
    return { ok: true, message: "Expiry date moved on." };
  });
}

export async function setAssetArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("finance.manage", async (user) => {
    await setAssetArchived(db, id, archived, user.id);
    refreshRenewals(id);
    return { ok: true, message: archived ? "Archived. It won't trigger renewal alerts." : "Restored." };
  });
}
