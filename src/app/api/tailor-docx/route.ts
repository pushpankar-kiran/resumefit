import { NextResponse } from "next/server";
import { forbidden, sameOrigin, unsafePattern } from "@/lib/security";
import { z } from "zod";
import { MAX_FILE_BYTES } from "@/lib/parsers";
import { tailorDocx } from "@/lib/docx-edit";
import type { TailorChange } from "@/lib/tailor";

export const runtime = "nodejs";

const Change = z.object({
  id: z.string().max(40),
  kind: z.string().max(20),
  label: z.string().max(300),
  before: z.string().max(2000),
  after: z.string().max(2000),
  find: z.string().max(2000),
  replace: z.string().max(2000),
  regex: z.object({ flags: z.string().regex(/^[gimsuy]*$/) }).optional(),
  note: z.string().max(300).optional(),
  enabled: z.boolean(),
  blocked: z.string().max(300).optional(),
});

/** POST multipart: `resume` (the original .docx) + `changes` (JSON array). Returns the edited .docx. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const form = await req.formData().catch(() => null);
  const file = form?.get("resume");
  const raw = form?.get("changes");
  if (!(file instanceof File) || typeof raw !== "string")
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Send the original .docx and the changes." } }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: { code: "FILE_TOO_LARGE", message: "Files must be 5 MB or smaller." } }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid changes." } }, { status: 400 });
  }
  const parsed = z.array(Change).max(300).safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid changes." } }, { status: 400 });
  // Patterns are compiled on the server: refuse ones that could backtrack catastrophically.
  const bad = parsed.data.find((c) => c.regex && unsafePattern(c.find));
  if (bad) return NextResponse.json({ error: { code: "BAD_REQUEST", message: `Change ${bad.id}: ${unsafePattern(bad.find)}.` } }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ error: { code: "NOT_DOCX", message: "Only .docx files can be edited in place." } }, { status: 422 });

  try {
    const { buffer, applied, notFound } = await tailorDocx(buf, parsed.data as TailorChange[]);
    const name = file.name.replace(/\.docx$/i, "").replace(/[^\w.-]+/g, "-") + "-tailored.docx";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Applied": String(applied.length),
        "X-Not-Found": notFound.map((id) => id.replace(/[^\w-]/g, "")).join(","),
      },
    });
  } catch (e) {
    console.error("[tailor-docx]", e);
    return NextResponse.json({ error: { code: "DOCX_EDIT_FAILED", message: "Couldn't edit this .docx. Download the tailored text from Export instead." } }, { status: 500 });
  }
}
