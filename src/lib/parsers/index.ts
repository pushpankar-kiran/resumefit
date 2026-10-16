import type { ParsedDocument } from "../types";
import { parsePdf } from "./pdf";
import { parseDocx } from "./docx";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export class ParseError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Detect the real file type from magic bytes rather than trusting the extension. */
function sniff(buf: Buffer): "pdf" | "docx" | "doc" | "image" | "text" | "unknown" {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "docx";
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return "doc";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image";
  const sample = buf.subarray(0, 2048);
  let bad = 0;
  for (const b of sample) if (b === 0 || (b < 9 && b !== 0)) bad++;
  return bad === 0 ? "text" : "unknown";
}

export async function parseResumeFile(buf: Buffer, fileName: string): Promise<ParsedDocument> {
  if (buf.length === 0) throw new ParseError("EMPTY_FILE", "The uploaded file is empty.");
  if (buf.length > MAX_FILE_BYTES) throw new ParseError("FILE_TOO_LARGE", "Files must be 5 MB or smaller.");

  const kind = sniff(buf);
  try {
    if (kind === "pdf") return clean(await parsePdf(new Uint8Array(buf), fileName));
    if (kind === "docx") return clean(await parseDocx(buf, fileName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("MALFORMED_FILE")) throw new ParseError("MALFORMED_FILE", msg.replace(/^MALFORMED_FILE:\s*/, ""));
    if (/password/i.test(msg)) throw new ParseError("ENCRYPTED_PDF", "This PDF is password-protected. Remove the password and upload again.");
    throw new ParseError("MALFORMED_FILE", `Could not read this file (${msg.slice(0, 120)}).`);
  }
  if (kind === "doc")
    throw new ParseError("UNSUPPORTED_TYPE", "Legacy .doc files aren't supported. Save it as .docx or PDF and upload again.");
  if (kind === "image")
    throw new ParseError("IMAGE_FILE", "This is an image, not a document. ATS systems can't read images; upload the original PDF/DOCX or run OCR first.");
  if (kind === "text") {
    const decoded = buf.toString("utf8");
    if ((decoded.match(/�/g) ?? []).length > decoded.length * 0.02)
      throw new ParseError("MALFORMED_FILE", "This file isn't readable text (wrong encoding or a binary file). Upload a PDF, DOCX or UTF-8 TXT.");
    return parseText(decoded, fileName);
  }
  throw new ParseError("UNSUPPORTED_TYPE", "Unsupported file type. Upload a PDF, DOCX or TXT resume.");
}

function clean(doc: ParsedDocument): ParsedDocument {
  return { ...doc, text: sanitize(doc.text), naiveText: sanitize(doc.naiveText) };
}

export function parseText(raw: string, fileName = "pasted.txt"): ParsedDocument {
  const text = sanitize(raw);
  return {
    fileType: "txt",
    fileName,
    text,
    layout: {
      columns: 1,
      hasTables: false,
      hasTextBoxes: false,
      imageCount: 0,
      headerFooterText: "",
      pageCount: 1,
      typography: null,
      page: null,
      hiddenTextChars: 0,
    },
    links: [],
    warnings: [],
    naiveText: text,
    sizeBytes: Buffer.byteLength(raw),
  };
}

/** Normalize unicode oddities that come out of copy/paste and PDF extraction. */
export function sanitize(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/ /g, " ")
    .replace(/[▪●◦‣⁃∙]/g, "•")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
