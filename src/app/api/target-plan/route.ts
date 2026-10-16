import { NextResponse } from "next/server";
import { buildLadder } from "@/lib/target";
import type { AnalysisResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST { base: AnalysisResult } → the target-score ladder for that analysis. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { base?: AnalysisResult } | null;
  const base = body?.base;
  if (!base?.resume?.text || typeof base.overallScore !== "number" || base.resume.text.length > 60000)
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Send the analysis to plan from." } }, { status: 400 });
  try {
    return NextResponse.json(await buildLadder(base));
  } catch (e) {
    console.error("[target-plan]", e);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Couldn't build the target plan." } }, { status: 500 });
  }
}
