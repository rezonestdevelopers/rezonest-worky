/** Makes a typed website safe to use as a link. Only http(s) is allowed, so "javascript:" links can't run. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(javascript|data|vbscript):/i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
