import { NextResponse } from "next/server";
import { ParseError, parseResumeFile, parseText, MAX_FILE_BYTES } from "@/lib/parsers";
import { AnalysisError, analyze } from "@/lib/analyze";

export const runtime = "nodejs";
export const maxDuration = 120;

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("BAD_REQUEST", "Send the resume and job description as multipart form data.");
  }

  const resumeFile = form.get("resume");
  const resumeText = form.get("resumeText");
  const jdFile = form.get("jdFile");
  let jd = typeof form.get("jd") === "string" ? (form.get("jd") as string) : "";
  const useLLM = form.get("useLLM") !== "false";

  try {
    let doc;
    if (resumeFile instanceof File && resumeFile.size > 0) {
      if (resumeFile.size > MAX_FILE_BYTES) return fail("FILE_TOO_LARGE", "Resume files must be 5 MB or smaller.", 413);
      doc = await parseResumeFile(Buffer.from(await resumeFile.arrayBuffer()), resumeFile.name);
    } else if (typeof resumeText === "string" && resumeText.trim()) {
      doc = parseText(resumeText, (form.get("resumeName") as string) || "pasted-resume.txt");
    } else {
      return fail("NO_RESUME", "Upload a resume file (PDF, DOCX or TXT) or paste resume text.");
    }

    if (!jd.trim() && jdFile instanceof File && jdFile.size > 0) {
      if (jdFile.size > MAX_FILE_BYTES) return fail("FILE_TOO_LARGE", "Job description files must be 5 MB or smaller.", 413);
      jd = (await parseResumeFile(Buffer.from(await jdFile.arrayBuffer()), jdFile.name)).text;
    }

    const result = await analyze(doc, jd, { useLLM });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ParseError || e instanceof AnalysisError) return fail(e.code, e.message, 422);
    console.error("[analyze] unexpected error", e);
    return fail("INTERNAL", "Something went wrong while analyzing. Please try again.", 500);
  }
}
