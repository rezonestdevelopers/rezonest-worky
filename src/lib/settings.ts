import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/** Agency settings (singleton row), cached per request. */
export const getSettings = cache(async () => {
  return db.settings.findUnique({ where: { id: "agency" } });
});

/** Only allow a plain hex colour into inline CSS. */
export function safeHex(value: string | null | undefined, fallback = "#d7202a"): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
