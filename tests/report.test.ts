import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseText } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";
import { buildClaudeReport, reportFileName } from "@/lib/report";
import { writeFileSync } from "node:fs";

describe("Claude-ready report", () => {
  it("contains the prompt, every finding and both source texts", async () => {
    const r = await analyze(parseText(SAMPLES[1].resume, "priya-shah-resume.txt"), SAMPLES[1].jd, { useLLM: false });
    const md = buildClaudeReport(r);
    writeFileSync("fixtures/sample-claude-report.md", md);
    expect(md).toMatch(/## Instructions for the assistant/);
    expect(md).toMatch(/Never invent numbers/);
    expect(md).toMatch(/Overall match score: \d+\/100/);
    expect(md).toMatch(/## 2\. Knockout screen/);
    for (const k of r.keywords.missingMustHave) expect(md).toContain(k);
    for (const i of r.formattingIssues) expect(md).toContain(i.issue.replace(/\|/g, "\|"));
    for (const w of r.writing.issues) expect(md).toContain(w.message);
    for (const b of r.bulletAudit) expect(md).toContain(b.text.replace(/\|/g, "\|"));
    expect(md).toContain("## Job description");
    expect(md).toContain(SAMPLES[1].jd.split("\n")[0]);
    expect(md).toContain("Where I've Been"); // resume text included verbatim
    expect(reportFileName(r)).toBe("priya-shah-resume-ats-report-for-claude.md");
  });

  it("works in general mode without keyword sections", async () => {
    const r = await analyze(parseText(SAMPLES[0].resume, "jordan.txt"), "", {});
    const md = buildClaudeReport(r);
    expect(md).toMatch(/General resume score/);
    expect(md).not.toMatch(/## 3\. Keyword gaps/);
    expect(md).not.toMatch(/## Job description/);
    expect(md).toMatch(/## 2\. Formatting/);
  });
});

describe("honest rewrites", () => {
  it("never upgrades a supporting role to leadership", async () => {
    const { heuristicRewrites, strengthenOpener } = await import("@/lib/nlp/suggest");
    const { structureJDHeuristic } = await import("@/lib/nlp/jd");
    const jd = structureJDHeuristic(SAMPLES[1].jd);
    for (const b of ["Supported the PM team on backlog grooming and sprint planning.", "Helped the sales team with enterprise demos.", "Assisted with quarterly planning for the data team.", "Helped improve the CI/CD pipeline in GitHub Actions."]) {
      const inflated = /^(Led|Owned|Managed|Directed|Spearheaded|Improved|Built)\b/;
      for (const o of heuristicRewrites(b, ["OKRs"], jd)) expect(o, b).not.toMatch(inflated);
      // Auto-tailor's opener fix must be just as honest.
      expect(strengthenOpener(b) ?? "", b).not.toMatch(inflated);
    }
  });
});
