import { NextResponse } from "next/server";
import { credentialSource, llmEnabled, MODEL } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, llm: llmEnabled(), model: llmEnabled() ? MODEL : null, credentialSource: credentialSource() });
}
