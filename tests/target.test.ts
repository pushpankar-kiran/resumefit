import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile, parseText } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";
import { buildLadder, selectionPlan } from "@/lib/target";
import { applyChanges } from "@/lib/tailor";

describe("target-score ladder", () => {
  it("orders automatic fixes before keywords and climbs monotonically-ish to a measured max", async () => {
    const base = await analyze(parseText(SAMPLES[1].resume, "pm.txt"), SAMPLES[1].jd, { useLLM: false });
    const t0 = Date.now();
    const ladder = await buildLadder(base);
    console.log(`ladder in ${Date.now() - t0} ms: base ${ladder.baseScore}, max ${ladder.maxProjected}, ${ladder.steps.length} steps`);
    for (const s of ladder.steps) console.log(`  ${s.projected} (${s.gain >= 0 ? "+" : ""}${s.gain}) ${s.keyword ? "[needs OK] " : ""}${s.label}`);
    const firstKw = ladder.steps.findIndex((s) => s.keyword);
    if (firstKw >= 0) expect(ladder.steps.slice(firstKw).every((s) => s.keyword)).toBe(true);
    expect(ladder.maxProjected).toBeGreaterThan(ladder.baseScore);
    // Re-applying a prefix reproduces its projected score.
    const prefix = ladder.steps.slice(0, 3);
    const keys = new Set(prefix.filter((s) => !s.keyword).map((s) => s.key));
    const text = applyChanges(base.resume.text, selectionPlan(base, keys, [])).text;
    const s = (await analyze(parseText(text, "x-tailored.txt"), SAMPLES[1].jd, { useLLM: false })).overallScore;
    expect(base.overallScore + (s - ladder.textBaseline)).toBe(prefix[prefix.length - 1].projected);
  }, 60000);

  it("projects against the file's own score for Word uploads", async () => {
    const buf = readFileSync("fixtures/templates/docx/word-needs-work.docx");
    const base = await analyze(await parseResumeFile(buf, "w.docx"), SAMPLES[1].jd, { useLLM: false });
    const ladder = await buildLadder(base);
    expect(ladder.baseScore).toBe(base.overallScore);
    expect(ladder.steps[0].projected).toBeGreaterThanOrEqual(base.overallScore);
  }, 60000);
});
