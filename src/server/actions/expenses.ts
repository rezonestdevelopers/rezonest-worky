"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import { DOCUMENT_MAX_BYTES, documentType, NOT_ALLOWED_FILE } from "@/lib/file-types";
import { can } from "@/lib/permissions";
import { putFile } from "@/lib/storage";
import { communicationSchema, documentCategorySchema, expenseSchema, type CommunicationInput, type ExpenseInput } from "@/lib/validators/expense";
import { runAction } from "@/server/action-guard";
import { addClientDocument, archiveClientDocument, archiveCommunication, attachBill, saveCommunication, saveExpense, setExpenseArchived } from "@/server/services/expenses";

function refreshExpense(id?: string, clientId?: string | null) {
  revalidatePath("/expenses");
  revalidatePath("/expenses/profit");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/expenses/${id}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function saveExpenseAction(id: string | null, input: ExpenseInput): Promise<ActionResult> {
  return runAction("finance.manage", async (user) => {
    const parsed = expenseSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const expense = await saveExpense(db, id, parsed.data, user.id);
    refreshExpense(expense.id, expense.clientId);
    return { ok: true, id: expense.id, message: "Expense saved." };
  });
}

export async function setExpenseArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("finance.manage", async (user) => {
    await setExpenseArchived(db, String(id), archived === true, user.id);
    refreshExpense(id);
    return { ok: true, message: archived ? "Expense archived." : "Expense restored." };
  });
}

/** Checks the file before anything is stored: its size, and what it really is. */
async function readUpload(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a file." } as const;
  if (file.size > DOCUMENT_MAX_BYTES) return { error: "Files must be 20 MB or smaller." } as const;
  const buf = Buffer.from(await file.arrayBuffer());
  const type = documentType(buf, file.name);
  if (!type) return { error: NOT_ALLOWED_FILE } as const;
  return { buf, type, name: file.name.slice(0, 200), size: file.size } as const;
}

export async function uploadBillAction(formData: FormData): Promise<ActionResult> {
  return runAction("finance.manage", async (user) => {
    const expenseId = String(formData.get("expenseId") ?? "");
    const upload = await readUpload(formData);
    if ("error" in upload) return { ok: false, error: upload.error as string };
    const storageKey = `private/bills/${crypto.randomUUID()}.${upload.type.ext}`;
    await putFile(storageKey, upload.buf, upload.type.mime);
    await attachBill(db, { expenseId, name: upload.name, storageKey, mimeType: upload.type.mime, sizeBytes: upload.size, actorId: user.id });
    refreshExpense(expenseId);
    return { ok: true, message: "Bill attached." };
  });
}

export async function uploadClientDocumentAction(formData: FormData): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const clientId = String(formData.get("clientId") ?? "");
    const category = documentCategorySchema.safeParse(formData.get("category"));
    if (!category.success) return { ok: false, error: "Choose what kind of document this is." };
    const upload = await readUpload(formData);
    if ("error" in upload) return { ok: false, error: upload.error as string };
    const canSeeMoney = can(user.role, "finance.manage");
    const storageKey = `private/documents/${crypto.randomUUID()}.${upload.type.ext}`;
    // Checked before storing as well as in the save, so a refused file isn't left behind.
    if (!canSeeMoney && (category.data === "BILL" || category.data === "INVOICE")) return { ok: false, error: "Only an admin can add bills and invoices." };
    await putFile(storageKey, upload.buf, upload.type.mime);
    await addClientDocument(db, { clientId, name: upload.name, category: category.data, storageKey, mimeType: upload.type.mime, sizeBytes: upload.size, actorId: user.id, canSeeMoney });
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, message: "Document added." };
  });
}

export async function archiveDocumentAction(id: string, clientId: string): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    await archiveClientDocument(db, String(id), user.id, can(user.role, "finance.manage"));
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, message: "Document archived." };
  });
}

function refreshCommunication(clientId: string | null | undefined, leadId: string | null | undefined) {
  if (clientId) revalidatePath(`/clients/${clientId}`);
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}

export async function saveCommunicationAction(id: string | null, input: CommunicationInput): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = communicationSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveCommunication(db, id, parsed.data, user.id);
    refreshCommunication(parsed.data.clientId, parsed.data.leadId);
    return { ok: true, message: parsed.data.nextActionDate ? "Saved. You'll be reminded on that date." : "Saved." };
  });
}

export async function archiveCommunicationAction(id: string, clientId: string | null, leadId: string | null): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    await archiveCommunication(db, String(id), user.id);
    refreshCommunication(clientId, leadId);
    return { ok: true, message: "Entry archived." };
  });
}
