import { findingIds } from "@/lib/scoring/findings";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseText } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";
import { DEFAULT_OPTIONS, applyChanges, manualTodos, normalizeDateLine, placeholders, planTailoring } from "@/lib/tailor";

const pm = SAMPLES[1];
const dev = SAMPLES[0];
const run = (resume: string, jd: string) => analyze(parseText(resume, "r.txt"), jd, { useLLM: false });

describe("auto-tailor", () => {
  it("applies safe fixes and raises the score without adding unconfirmed keywords", async () => {
    const before = await run(pm.resume, pm.jd);
    const plan = planTailoring(before, DEFAULT_OPTIONS);
    const { text, skipped } = applyChanges(before.resume.text, plan);
    console.log(plan.map((c) => `${c.kind}: ${c.before} → ${c.after}`).join("\n"));
    expect(skipped).toHaveLength(0);
    expect(text).toMatch(/^PROFESSIONAL SUMMARY$|^Professional Summary$/m);
    expect(text).toMatch(/Work Experience/);
    expect(text).toMatch(/Jan 2021 – Present/);
    expect(text).toMatch(/\[Month\] 2018 – Dec 2020/);
    expect(text).not.toMatch(/Responsible for/);
    expect(text).not.toMatch(/Worked on A\/B/);
    // Never inflates: the "Supported" bullet doesn't become "Led".
    expect(text).not.toMatch(/Led the PM team/);
    // Missing tools the user didn't confirm are never added.
    for (const k of ["Looker", "Mixpanel", "Amplitude", "Salesforce"]) expect(text).not.toContain(k);
    const after = await run(text, pm.jd);
    console.log("score", before.overallScore, "→", after.overallScore);
    expect(after.overallScore).toBeGreaterThan(before.overallScore);
    expect(findingIds(after.formattingIssues)).not.toContain("nonstandard-experience");
  });

  it("adds only the keywords the user confirms", async () => {
    const before = await run(dev.resume, dev.jd);
    const plan = planTailoring(before, { ...DEFAULT_OPTIONS, addKeywords: ["Docker", "GraphQL"] });
    const { text } = applyChanges(before.resume.text, plan);
    expect(text).toMatch(/AWS \(S3, EC2\), Agile, Docker, GraphQL|Docker, GraphQL/);
    expect(text).not.toContain("Kubernetes");
    const after = await run(text, dev.jd);
    expect(after.keywords.matched).toEqual(expect.arrayContaining(["Docker", "GraphQL"]));
    expect(after.overallScore).toBeGreaterThan(before.overallScore);
  });

  it("lets the user switch individual changes off", async () => {
    const before = await run(pm.resume, pm.jd);
    const plan = planTailoring(before, DEFAULT_OPTIONS).map((c) => (c.kind === "heading" ? { ...c, enabled: false } : c));
    const { text } = applyChanges(before.resume.text, plan);
    expect(text).toContain("Where I've Been");
  });

  it("flags placeholders and manual to-dos", async () => {
    const before = await run(pm.resume, pm.jd);
    const plan = planTailoring(before, { ...DEFAULT_OPTIONS, metricPlaceholders: true });
    const { text } = applyChanges(before.resume.text, plan);
    expect(placeholders(text).length).toBeGreaterThan(0);
    const todos = manualTodos(before, DEFAULT_OPTIONS);
    expect(todos.some((t) => /LinkedIn/.test(t))).toBe(true);
    expect(todos.some((t) => /Looker|Mixpanel/.test(t))).toBe(true);
  });

  it("never touches phone numbers when normalizing dates", () => {
    expect(normalizeDateLine("+1 (415) 555-0199 • San Francisco, CA")).toBeNull();
    expect(normalizeDateLine("Engineer | Acme | 03/2019 - 2021")?.text).toBe("Engineer | Acme | Mar 2019 – 2021");
  });
});
