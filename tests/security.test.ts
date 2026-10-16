// Security regression tests: cross-site requests, client-supplied regexes, zip bombs and headers.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { POST as analyzePost } from "@/app/api/analyze/route";
import { POST as tailorPost } from "@/app/api/tailor-docx/route";
import { POST as rewritePost } from "@/app/api/rewrite/route";
import { parseResumeFile } from "@/lib/parsers";
import { MAX_DOCX_UNCOMPRESSED, sameOrigin, unsafePattern } from "@/lib/security";
// @ts-expect-error: next.config.mjs is plain JS with no type declarations
import nextConfig from "../next.config.mjs";
import { buildDocx, p } from "./helpers/docx";

const req = (headers: Record<string, string>, body?: BodyInit) =>
  new Request("http://127.0.0.1:3221/api/x", { method: "POST", headers: { host: "127.0.0.1:3221", ...headers }, body });

describe("cross-site requests", () => {
  it("accepts the app's own page and non-browser clients", () => {
    expect(sameOrigin(req({ origin: "http://127.0.0.1:3221", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(req({}))).toBe(true); // curl / scripts send no Origin
  });
  it("rejects other websites driving the local server through the browser", () => {
    expect(sameOrigin(req({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(sameOrigin(req({ origin: "null" }))).toBe(false);
  });
  it("every POST route answers a cross-site request with 403 before doing any work", async () => {
    const evil = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    for (const post of [analyzePost, tailorPost, rewritePost]) {
      const res = await post(req(evil, new FormData()));
      expect(res.status).toBe(403);
    }
  });
});

describe("client-supplied regular expressions (tailor-docx)", () => {
  it.each(["(a+)+$", "(\\w+\\s?)*$", "(a|aa)*b", "(x+){2,}", "(.*a){12}", "(a)\\1", "a".repeat(401)])("rejects %s", (src) => {
    expect(unsafePattern(src)).not.toBeNull();
  });
  it.each(["\\b(January|February|March)\\b", "^PROFESSIONAL EXPERIENCE$", "(\\d{4})\\s*[-–]\\s*(\\d{4}|Present)", "Responsible for"])("accepts %s", (src) => {
    expect(unsafePattern(src)).toBeNull();
  });
  const docxForm = async (changes: string) => {
    const fd = new FormData();
    fd.set("resume", new File([new Uint8Array(await buildDocx({ body: p("Alex Doe") + p("Responsible for reports") }))], "r.docx"));
    fd.set("changes", changes);
    return fd;
  };
  const change = (find: string, regex = true) => ({ id: "c1", kind: "bullet", label: "x", before: "a", after: "b", find, replace: "Wrote", enabled: true, ...(regex ? { regex: { flags: "" } } : {}) });
  it("malformed JSON is a 400, not a crash", async () => {
    const res = await tailorPost(req({}, await docxForm("{not json")));
    expect(res.status).toBe(400);
  });
  it("a catastrophic-backtracking pattern is refused with a 400", async () => {
    const res = await tailorPost(req({}, await docxForm(JSON.stringify([change("(a+)+$")]))));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/nested quantifiers/);
  });
  it("a normal change still edits the file", async () => {
    const res = await tailorPost(req({}, await docxForm(JSON.stringify([change("Responsible for", false)]))));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Applied")).toBe("1");
  });
});

describe("zip bombs", () => {
  it("rejects a small .docx that would inflate past the limit", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
    zip.file("word/media/pad.bin", new Uint8Array(MAX_DOCX_UNCOMPRESSED + 1024)); // zeros: compresses to almost nothing
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(buf.length).toBeLessThan(5 * 1024 * 1024); // passes the upload size check...
    await expect(parseResumeFile(buf, "bomb.docx")).rejects.toThrow(/unreasonable size/); // ...but never gets inflated
  }, 60_000);
});

describe("security headers", () => {
  it("every response gets a strict CSP and anti-framing / anti-sniffing headers", async () => {
    const rules = await nextConfig.headers!();
    const h = Object.fromEntries(rules[0].headers.map((x: { key: string; value: string }) => [x.key, x.value]));
    expect(rules[0].source).toBe("/:path*");
    expect(h["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["Content-Security-Policy"]).toMatch(/object-src 'none'/);
    expect(h["Content-Security-Policy"]).toMatch(/connect-src 'self'/);
    expect(h["Content-Security-Policy"]).not.toMatch(/unsafe-eval/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
  it("the server is bound to localhost only", async () => {
    const pkg = JSON.parse((await import("node:fs")).readFileSync("package.json", "utf8"));
    expect(pkg.scripts.start).toMatch(/-H 127\.0\.0\.1/);
    expect(pkg.scripts.dev).toMatch(/-H 127\.0\.0\.1/);
  });
});
