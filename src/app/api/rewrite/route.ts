import { NextResponse } from "next/server";
import { forbidden, sameOrigin } from "@/lib/security";
import { z } from "zod";
import { llmEnabled, MODEL, rewriteWithClaude } from "@/lib/ai/claude";
import { heuristicRewrites } from "@/lib/nlp/suggest";
import { unsafeSuggestion } from "@/lib/nlp/swaps";
import type { StructuredJD } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  bullet: z.string().min(3).max(600),
  missingKeywords: z.array(z.string().max(80)).max(30).default([]),
  targetTitle: z.string().max(200).default(""),
  responsibilities: z.array(z.string().max(300)).max(15).default([]),
  context: z.string().max(400).default(""),
  useLLM: z.boolean().default(true),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Provide a bullet (3-600 characters)." } }, { status: 400 });
  const b = parsed.data;
  const jd: StructuredJD = {
    targetTitle: b.targetTitle,
    experienceYears: null,
    seniority: null,
    education: null,
    keywords: [],
    responsibilities: b.responsibilities,
    language: "English",
    source: "heuristic",
  };

  if (b.useLLM && llmEnabled()) {
    try {
      // Claude's options pass the same safety rules as the built-in ones.
      const options = (await rewriteWithClaude(b.bullet, b.missingKeywords, b.targetTitle, b.context)).filter((o) => !unsafeSuggestion(b.bullet, o));
      if (options.length) return NextResponse.json({ options, source: "ai", model: MODEL });
    } catch (e) {
      console.warn("[rewrite] falling back to heuristic:", (e as Error).message);
    }
  }
  return NextResponse.json({ options: heuristicRewrites(b.bullet, b.missingKeywords, jd), source: "heuristic", model: null });
}
