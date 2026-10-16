import { findingIds } from "@/lib/scoring/findings";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseText } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";
import { findDateRanges, totalYears } from "@/lib/nlp/dates";
import { findTerm } from "@/lib/nlp/text";
import { structureJDHeuristic } from "@/lib/nlp/jd";
import { parseResume, classifyHeading } from "@/lib/nlp/resume";
import { titleSimilarity } from "@/lib/scoring/engine";
import { heuristicRewrites } from "@/lib/nlp/suggest";

const dev = SAMPLES[0];
const pm = SAMPLES[1];

describe("dates", () => {
  it("parses common range formats", () => {
    expect(findDateRanges("Mar 2022 – Present")[0].end).toBe("present");
    expect(findDateRanges("01/2021 - 03/2023")[0].format).toBe("MM/YYYY");
    expect(findDateRanges("January 2019 to June 2020")[0].format).toBe("Month YYYY");
    expect(findDateRanges("2018 - 2020")[0].start.year).toBe(2018);
  });
  it("merges overlapping roles", () => {
    const r = [...findDateRanges("Jan 2020 - Dec 2021"), ...findDateRanges("Jun 2021 - Dec 2022")];
    expect(totalYears(r)).toBe(3);
  });
});

describe("term matching", () => {
  it("respects case for ambiguous words", () => {
    expect(findTerm("We go fast", "go")).toHaveLength(0);
    expect(findTerm("Python, Go, SQL", "go")).toHaveLength(1);
    expect(findTerm("go-to-market launch", "go")).toHaveLength(0);
    expect(findTerm("react quickly", "react")).toHaveLength(0);
    expect(findTerm("Built with React", "react")).toHaveLength(1);
  });
  it("handles punctuation-heavy skills", () => {
    expect(findTerm("Experienced in C++ and C#", "C++")).toHaveLength(1);
    expect(findTerm("Node.js services", "Node.js")).toHaveLength(1);
    expect(findTerm("CI/CD pipelines", "CI/CD")).toHaveLength(1);
    expect(findTerm("RESTful APIs", "REST APIs")).toHaveLength(0);
    expect(findTerm("RESTful APIs", "restful apis")).toHaveLength(1);
  });
});

describe("JD structuring", () => {
  const jd = structureJDHeuristic(dev.jd);
  it("finds title, years and priorities", () => {
    expect(jd.targetTitle).toBe("Senior Full-Stack Engineer");
    expect(jd.experienceYears).toBe(5);
    const k = (t: string) => jd.keywords.find((x) => x.term === t);
    expect(k("Docker")?.priority).toBe("must");
    expect(k("Kubernetes")?.priority).toBe("must");
    expect(k("Terraform")?.priority).toBe("nice");
    expect(k("AWS Lambda")?.priority).toBe("nice");
  });
});

describe("resume parsing", () => {
  it("flags creative headings", () => {
    expect(classifyHeading("Where I've Been")).toEqual({ key: "experience", standard: false });
    expect(classifyHeading("WORK EXPERIENCE")).toEqual({ key: "experience", standard: true });
  });
  it("extracts roles and contact", () => {
    const r = parseResume(dev.resume);
    expect(r.roles).toHaveLength(3);
    expect(r.roles[0].title).toBe("Software Engineer II");
    expect(r.contact.email).toBe("jordan.rivera@example.com");
    expect(r.contact.linkedin).toContain("linkedin.com/in/");
    expect(r.totalYears).toBeGreaterThan(6);
  });
});

describe("title similarity", () => {
  it("scores near titles high and unrelated low", () => {
    expect(titleSimilarity("Senior Software Engineer", "Software Developer")).toBeGreaterThan(0.8);
    expect(titleSimilarity("Senior Product Manager", "Product Manager")).toBeGreaterThan(0.9);
    expect(titleSimilarity("Data Scientist", "Product Manager")).toBeLessThan(0.3);
  });
});

describe("end-to-end (heuristic engine)", () => {
  it("scores the developer sample with expected gaps", async () => {
    const r = await analyze(parseText(dev.resume, dev.resumeName), dev.jd, { useLLM: false });
    console.log(JSON.stringify({ overall: r.overallScore, cat: r.categoryScores, kw: r.keywords.missingMustHave, nice: r.keywords.missingNiceToHave, matched: r.keywords.matched }, null, 1));
    expect(r.keywords.missingMustHave).toEqual(expect.arrayContaining(["Docker", "Kubernetes", "GraphQL"]));
    expect(r.keywords.matched).toEqual(expect.arrayContaining(["React", "TypeScript", "Node.js", "CI/CD"]));
    expect(r.overallScore).toBeGreaterThan(40);
    expect(r.overallScore).toBeLessThan(90);
    expect(r.bulletPointImprovements.length).toBeGreaterThan(0);
  });
  it("flags the PM sample's structure and date problems", async () => {
    const r = await analyze(parseText(pm.resume, pm.resumeName), pm.jd, { useLLM: false });
    console.log(JSON.stringify({ overall: r.overallScore, cat: r.categoryScores, issues: r.formattingIssues.map((i) => i.issue), miss: r.keywords.missingMustHave, nice: r.keywords.missingNiceToHave }, null, 1));
    const ids = findingIds(r.formattingIssues);
    expect(ids).toEqual(expect.arrayContaining(["nonstandard-experience", "date-unparsed", "missing-linkedin"]));
    expect(r.categoryScores.sectionStructure).toBeLessThan(100);
  });
  it("rejects empty / short inputs", async () => {
    await expect(analyze(parseText("hello"), dev.jd)).rejects.toThrow(/too little/);
    await expect(analyze(parseText(dev.resume), "short jd")).rejects.toThrow(/too short/);
  });
});

describe("rewriter", () => {
  it("removes weak openers and never invents numbers", () => {
    const opts = heuristicRewrites("Worked on backend APIs using Node.js.", ["Docker"], structureJDHeuristic(dev.jd));
    expect(opts.length).toBeGreaterThanOrEqual(1);
    for (const o of opts) {
      expect(o.toLowerCase().startsWith("worked on")).toBe(false);
      expect(o).not.toMatch(/\b\d+%/);
    }
    console.log(opts);
  });
});

describe("keyword placements", () => {
  it("substitutes into a bullet (never appends a clause), never reuses a bullet, else points to Skills", async () => {
    for (const sm of SAMPLES) {
      const r = await analyze(parseText(sm.resume, sm.resumeName), sm.jd, { useLLM: false });
      const exp = r.keywordPlacements.filter((p) => p.targetBullet);
      for (const p of exp) {
        expect(p.suggestion).toContain(p.keyword);
        expect(p.suggestion).not.toContain(", supporting ");
        expect(p.suggestion).not.toMatch(/\b(?:with|using|alongside) [A-Z]\S*\.?$/);
        // Only the keyword's own words are added.
        expect(p.suggestion.length - p.targetBullet!.length).toBeLessThanOrEqual(p.keyword.length + 2);
      }
      expect(new Set(exp.map((p) => p.targetBullet)).size).toBe(exp.length);
      for (const p of r.keywordPlacements.filter((x) => !x.targetBullet)) expect(p.section).toBe("Skills");
    }
  });
});

describe("export", () => {
  it("converts resume text to clean Markdown", async () => {
    const { toMarkdown } = await import("@/lib/export");
    const md = toMarkdown(pm.resume);
    expect(md.startsWith("# Priya Shah")).toBe(true);
    expect(md).toContain("## Where I've Been");
    expect(md).toContain("- Owned the roadmap");
  });
  it("does not count unfilled placeholders as metrics", async () => {
    const { hasMetric } = await import("@/lib/nlp/verbs");
    expect(hasMetric("Improved onboarding, lifting activation by [X%]")).toBe(false);
    expect(hasMetric("Improved onboarding, lifting activation by 22%")).toBe(true);
  });
});
