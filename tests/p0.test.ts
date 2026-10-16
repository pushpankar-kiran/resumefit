import { findingIds } from "@/lib/scoring/findings";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile, parseText } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";
import { jdEducation, resumeEducation, scoreEducation } from "@/lib/nlp/education";
import { parseResume } from "@/lib/nlp/resume";
import { levelOfTitle } from "@/lib/scoring/engine";
import { analyzeWriting } from "@/lib/nlp/writing";
import { chronologyChecks, contactQualityChecks, fileChecks } from "@/lib/nlp/checks";
import { acronymPair } from "@/lib/nlp/matcher";

const dev = SAMPLES[0];
const pm = SAMPLES[1];
const fixture = (f: string) => parseResumeFile(readFileSync(`fixtures/${f}`), f);

describe("P0-1 education match", () => {
  it("parses JD requirements", () => {
    const e = jdEducation("Requirements:\n- Bachelor's degree in Computer Science or equivalent experience\n- Master's degree preferred");
    expect(e?.level).toBe(3);
    expect(e?.required).toBe(true);
    expect(e?.equivalentExperienceOk).toBe(true);
    expect(e?.fields).toContain("Computer Science");
  });
  it("reads resume degrees and scores the gap", () => {
    expect(resumeEducation(parseResume(pm.resume))[0].level).toBe(4); // MBA
    expect(resumeEducation(parseResume(dev.resume))[0].level).toBe(3); // B.S.
    const req = jdEducation("A Master's degree in Data Science is required.");
    expect(scoreEducation(req, [{ level: 3 }]).score).toBe(45);
    expect(scoreEducation(req, [{ level: 4 }]).score).toBe(100);
    expect(scoreEducation(null, []).score).toBeNull();
  });
});

describe("P0-2 seniority", () => {
  it("reads levels from titles without confusing role names", () => {
    expect(levelOfTitle("Senior Product Manager")).toBe(3);
    expect(levelOfTitle("Product Manager")).toBe(2);
    expect(levelOfTitle("Staff Engineer")).toBe(4);
    expect(levelOfTitle("Associate Product Manager")).toBe(1);
    expect(levelOfTitle("Director of Engineering")).toBe(6);
  });
  it("feeds Experience Alignment", async () => {
    const r = await analyze(parseText(dev.resume, dev.resumeName), dev.jd, { useLLM: false });
    expect(r.explanations.experienceAlignment.some((e) => e.label.startsWith("Seniority level"))).toBe(true);
  });
});

describe("P0-3 keyword frequency", () => {
  it("counts JD and resume mentions and weights repeated keywords", async () => {
    const r = await analyze(parseText(dev.resume, dev.resumeName), dev.jd, { useLLM: false });
    const gql = r.keywords.details.find((m) => m.term === "GraphQL")!;
    expect(gql.jdCount).toBe(2);
    expect(gql.resumeCount).toBe(0);
    expect(gql.frequencyWeight).toBe(1.25);
    const react = r.keywords.details.find((m) => m.term === "React")!;
    expect(react.resumeCount).toBeGreaterThanOrEqual(3);
  });
});

describe("P0-4/5 writing quality", () => {
  const bad = `Alex Doe
alex@example.com | 555-123-4567

SUMMARY
I am a passionate team player and a results-driven engineer who really loves stuff!

EXPERIENCE
Engineer | Acme | Jan 2019 - Dec 2021
• Managed managment of the the deployment pipeline for various teams.
• Managed a API migration and recieved an award.
• Managed onboarding of 5 engineers, which was led by me.
• manage weekly reports in order to track progress.

EDUCATION
B.S. Computer Science, State University, 2018

SKILLS
Python, Docker, AWS`;
  it("flags spelling, grammar, repetition, buzzwords, filler and tone", async () => {
    const w = await analyzeWriting(parseResume(bad));
    const has = (kind: string, text: RegExp) => w.issues.some((i) => i.kind === kind && text.test(i.text));
    expect(has("spelling", /managment/i)).toBe(true);
    expect(has("spelling", /recieved/i)).toBe(true);
    expect(has("grammar", /the the/i)).toBe(true);
    expect(has("grammar", /^manage$/i)).toBe(true); // lowercase bullet / present tense in past role
    expect(has("repetition", /managed/i)).toBe(true);
    expect(has("buzzword", /team player/)).toBe(true);
    expect(has("filler", /in order to/)).toBe(true);
    expect(w.tone).not.toBe("professional");
    expect(w.score).toBeLessThan(70);
  });
  it("doesn't flag tech vocabulary in a clean resume", async () => {
    const w = await analyzeWriting(parseResume(dev.resume));
    expect(w.counts.spelling).toBe(0);
  });
});

describe("P0-6 ATS view & parse rate", () => {
  it("scores a clean single-column PDF highly", async () => {
    const r = await analyze(await fixture("resume-single-column.pdf"), dev.jd, { useLLM: false });
    expect(r.atsView.parseRate).toBeGreaterThanOrEqual(90);
  });
  it("shows what a two-column layout with header contacts loses", async () => {
    const r = await analyze(await fixture("resume-two-column.pdf"), dev.jd, { useLLM: false });
    expect(r.atsView.parseRate).toBeLessThan(60);
    expect(r.atsView.fields.find((f) => f.label === "Email")?.note).toMatch(/header/);
    expect(r.atsView.naiveText).toMatch(/SKILLS WORK EXPERIENCE/);
  });
});

describe("P0-7 typography, page and hidden text", () => {
  it("reads fonts, sizes and page size from PDF", async () => {
    const d = await fixture("resume-single-column.pdf");
    expect(d.layout.typography?.fonts[0].name).toBe("Helvetica");
    expect(d.layout.typography?.bodySize).toBe(10);
    expect(d.layout.page).toMatchObject({ width: 612, height: 792 });
  });
  it("reads margins from DOCX", async () => {
    const d = await fixture("resume-risky.docx");
    expect(d.layout.page?.margins?.top).toBe(72);
    expect(d.layout.typography?.fonts.length).toBeGreaterThan(0);
  });
  it("catches white-text keyword stuffing", async () => {
    const d = await fixture("resume-hidden-text.pdf");
    expect(d.layout.hiddenTextChars).toBeGreaterThan(50);
    const r = await analyze(d, dev.jd, { useLLM: false });
    expect(r.formattingIssues.flatMap((i) => i.items ?? [i]).some((i) => i.id === "hidden-text" && i.severity === "high")).toBe(true);
  });
});

describe("P0-8 acronyms & stuffing", () => {
  it("pairs acronyms only with their own expansion", () => {
    expect(acronymPair("Google Cloud Platform", ["GCP", "google cloud"])).toEqual({ short: "GCP", long: "Google Cloud Platform" });
    expect(acronymPair("Microservices", ["soa", "service-oriented architecture"])).toBeNull();
    expect(acronymPair("SQL", ["structured query language"])).toBeNull();
  });
  it("flags a keyword repeated far beyond the JD", async () => {
    const stuffed = dev.resume.replace("SKILLS\n", "SKILLS\n" + "React, ".repeat(12) + "\n");
    const r = await analyze(parseText(stuffed, "jordan.txt"), dev.jd, { useLLM: false });
    expect(findingIds(r.formattingIssues)).toContain("stuffing");
  });
});

describe("P0-9 general mode", () => {
  it("scores without a job description", async () => {
    const r = await analyze(parseText(pm.resume, "priya.txt"), "", {});
    expect(r.mode).toBe("general");
    expect(r.categoryScores.hardSkills).toBeNull();
    expect(Object.values(r.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(r.overallScore).toBeGreaterThan(0);
    expect(r.keywords.details).toHaveLength(0);
  });
});

describe("P0-10 order, file & contact checks", () => {
  it("flags non-chronological experience", () => {
    const r = parseResume(`EXPERIENCE
Engineer | A | Jan 2015 - Dec 2017
• Built things for customers across regions
Senior Engineer | B | Jan 2018 - Present
• Led a team of 5 engineers on platform work`);
    expect(chronologyChecks(r).issues[0]?.issue).toMatch(/reverse-chronological/);
  });
  it("flags generic file names, unprofessional email and missing GitHub", () => {
    const doc = parseText(dev.resume, "resume (1) final.pdf");
    const f = fileChecks({ ...doc, fileName: "resume (1) final.pdf", fileType: "pdf" }, "Jordan Rivera");
    expect(f.issues.some((i) => i.id === "file-name")).toBe(true);
    const r = parseResume(dev.resume.replace("jordan.rivera@example.com", "sexyguy1990@aol.com"));
    const c = contactQualityChecks(r, [], "Senior Software Engineer");
    expect(c.checks.find((x) => x.id === "email-quality")?.status).toBe("fail");
    expect(c.checks.find((x) => x.id === "web-presence")?.status).toBe("warn");
  });
});
