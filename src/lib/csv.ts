/** A value as export text. Dates are ISO, and money keeps its exact digits. */
export function exportValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) return JSON.stringify(v);
  return String(v);
}

/**
 * One CSV cell. A value starting with = + - @ would run as a formula when opened in Excel, so it's
 * marked as text. Plain numbers keep their sign.
 */
export function csvCell(v: unknown): string {
  const value = exportValue(v);
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** With a byte-order mark, so Excel reads ₹ and Indian names correctly. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvCell).join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const columnsOf = (rows: Record<string, unknown>[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))];
