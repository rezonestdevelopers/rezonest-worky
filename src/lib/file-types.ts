/** Check real file signature (magic bytes), not just the extension. */
export function sniffImage(buf: Buffer): "png" | "jpg" | "webp" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}

const OFFICE = /\.(docx|xlsx|pptx)$/i;
const OFFICE_MIME = "application/octet-stream";

/** What a file really is, from its contents. Anything else is refused, whatever its name says. */
export function documentType(buf: Buffer, name: string): { ext: string; mime: string } | null {
  const image = sniffImage(buf);
  if (image) return { ext: image, mime: image === "jpg" ? "image/jpeg" : `image/${image}` };
  if (buf.subarray(0, 5).toString() === "%PDF-") return { ext: "pdf", mime: "application/pdf" };
  if (buf.subarray(0, 2).toString() === "PK" && OFFICE.test(name)) return { ext: name.split(".").pop()!.toLowerCase(), mime: OFFICE_MIME };
  return null;
}

/** Only these open in the browser. Everything else downloads. */
export const canPreview = (mime: string) => mime === "application/pdf" || /^image\/(png|jpeg|webp)$/.test(mime);

export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const NOT_ALLOWED_FILE = "Only images, PDF, Word, Excel and PowerPoint files are allowed.";

export const formatFileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`);

/** Bills and invoices carry prices, so only people who can see money see them. */
export const FINANCE_DOCUMENT_CATEGORIES = ["BILL", "INVOICE"] as const;
export const isFinanceDocument = (category: string) => (FINANCE_DOCUMENT_CATEGORIES as readonly string[]).includes(category);

export const DOCUMENT_CATEGORIES = ["AGREEMENT", "NDA", "BRAND_ASSET", "BRIEF", "REPORT", "INVOICE", "BILL", "CREATIVE", "OTHER"] as const;
const LABEL: Record<string, string> = { AGREEMENT: "Agreement", NDA: "NDA", BRAND_ASSET: "Brand asset", BRIEF: "Brief", REPORT: "Report", INVOICE: "Invoice", BILL: "Bill", CREATIVE: "Creative", OTHER: "Other" };
export const documentCategoryLabel = (category: string) => LABEL[category] ?? category;
