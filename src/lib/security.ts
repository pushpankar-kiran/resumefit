// Request and input guards for the local API. The app is meant to run on 127.0.0.1 only; these
// checks stop other websites open in the same browser from driving it (cross-site requests to
// localhost), and stop crafted inputs from tying up the server.

/**
 * True when the request comes from this app's own pages (or from a non-browser client such as
 * curl, which sends no Origin). Browsers always send Origin on cross-site POSTs, so a page on
 * another site can't use the analyzer, or your Claude credits, through your browser.
 */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const forbidden = () =>
  Response.json({ error: { code: "FORBIDDEN", message: "Requests must come from the analyzer's own page." } }, { status: 403 });

/**
 * A regular expression sent by the client (tailor changes) is compiled on the server, so it
 * must be short and free of the shapes that cause catastrophic backtracking: nested
 * quantifiers like (a+)+ or (a|a)*, and back-references. Returns the reason it's rejected.
 */
export function unsafePattern(source: string): string | null {
  if (source.length > 400) return "pattern too long";
  if (/\\[1-9]/.test(source)) return "back-references are not allowed";
  // A quantified group that itself contains a quantifier: (x+)+, (x*)*, (x+){2,}, (a|b+)*.
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(source)) return "nested quantifiers are not allowed";
  // A quantified alternation can match the same text several ways: (a|aa)*, (x|x?)+.
  if (/\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*{]/.test(source)) return "quantified alternations are not allowed";
  try {
    new RegExp(source);
  } catch {
    return "invalid pattern";
  }
  return null;
}

/**
 * True when `link` (a URL, or a bare "github.com/user") points at `domain` or a subdomain of
 * it. Parses the host instead of regex-matching, so "evil.com/?q=github.com" or
 * "github.com.evil.io" never count.
 */
export function hostIs(link: string, domain: string): boolean {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`);
    const host = u.hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/** Decompressed-size budget for a .docx (a 5 MB upload must not inflate into gigabytes). */
export const MAX_DOCX_UNCOMPRESSED = 60 * 1024 * 1024;

/** Sum of the entries' uncompressed sizes, from the zip directory (before inflating anything). */
export function uncompressedSize(zip: { files: Record<string, unknown> }): number {
  let total = 0;
  for (const f of Object.values(zip.files)) {
    const data = (f as { _data?: { uncompressedSize?: number } })._data;
    total += data?.uncompressedSize ?? 0;
  }
  return total;
}
