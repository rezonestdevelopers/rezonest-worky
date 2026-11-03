import type { ZodError } from "zod";
import type { DuplicateMatch } from "./contact-match";

/** What every server action returns to the form that called it. */
export type ActionResult =
  | { ok: true; message?: string; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; duplicates?: DuplicateMatch[] };

export function invalid(error: ZodError, message = "Please fix the highlighted fields."): ActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  return { ok: false, error: message, fieldErrors };
}
