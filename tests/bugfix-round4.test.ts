// Round 4: two-column PDFs. Every test asserts extracted facts (reading order, sections,
// bullets, roles, names), never score values.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile, parseText } from "@/lib/parsers";
import { buildClaudeReport } from "@/lib/report";
import { KNOCKOUT_VERDICT } from "@/lib/nlp/knockouts";
import { unsafeSuggestion } from "@/lib/nlp/swaps";
import { hasNumber, metricOptional } from "@/lib/nlp/verbs";
import { canonicalSection, classifyHeading, parseResume } from "@/lib/nlp/resume";
import { EDUCATION_ROWS, RIGHT, SUMMARY, resumeParagraphs, twoColumnResumePdf } from "./helpers/pdf";
import { buildDocx, p, tbl, tc, tr } from "./helpers/docx";

const FELLO_BULLET =
  "Led redesign of a stagnant lead conversion process, from business case to go-live, via design thinking, as-is/to-be mapping and fit-gap analysis, improving lead engagement 20% to 40% and qualified conversions 30%";
const JD_TEXT =
  "Role: Program and Product Manager\nRequirements:\n- Master's degree in management required\n- 5+ years of experience in product management with roadmaps, prioritization and stakeholder management\n- Agile and Scrum delivery, risk management, cloud computing";

const synthetic = (async () => {
  const doc = await parseResumeFile(twoColumnResumePdf(), "Ananya-Rao-Resume.pdf");
  return { doc, r: await analyze(doc, JD_TEXT, { useLLM: false }) };
})();
const experienceBullets = (r: Awaited<typeof synthetic>["r"]) => r.bulletAudit.map((b) => b.text);

describe("Bug 1: two-column PDFs read column by column", () => {
  it("detects the gutter and reads the left column, then the right", async () => {
    const { doc } = await synthetic;
    expect(doc.layout.columns).toBe(2);
    const t = doc.text;
    expect(t.indexOf("PROFESSIONAL EXPERIENCE")).toBeLessThan(t.indexOf("KEY SKILLS"));
    expect(t).not.toMatch(/PROFESSIONAL EXPERIENCE KEY SKILLS/);
    expect(t).not.toMatch(/2025 • GENAI/);
  });
  it("keeps full-width bands (header, summary) apart from the columns", async () => {
    const { doc } = await synthetic;
    expect(doc.text).toContain("roadmap ownership, team leadership and stakeholder management.");
    expect(doc.text.indexOf("PROFILE SUMMARY")).toBeLessThan(doc.text.indexOf("PROFESSIONAL EXPERIENCE"));
  });
  it("re-joins wrapped bullets into one contiguous string", async () => {
    const { doc } = await synthetic;
    expect(doc.text).toContain(FELLO_BULLET);
  });
  it("no skill line ends up inside an experience bullet", async () => {
    const { r } = await synthetic;
    for (const b of experienceBullets(r)) expect(b).not.toMatch(/PROJECT MANAGEMENT|GENAI|KEY SKILLS/);
  });
  it("rebuilds the qualifications table row by row", async () => {
    const { doc } = await synthetic;
    expect(doc.text).toContain("MBA (PGPM) | Westbrook School of Management, Pune | 3.20/4 | 2027");
  });
  it("single-column PDFs still read as one column", async () => {
    const doc = await parseResumeFile(readFileSync("fixtures/resume-single-column.pdf"), "single.pdf");
    expect(doc.layout.columns).toBe(1);
  });
});

const EXPECTED_SECTIONS = ["Summary", "Work Experience", "Skills", "Education", "Projects", "Awards", "Leadership", "Interests", "Languages"];
const sectionSet = (r: Awaited<typeof synthetic>["r"]) => r.resume.sections.filter((s) => s.key !== "contact").map((s) => s.canonical);

describe("Bug 2: section headings per column, with synonyms", () => {
  it.each([
    ["PROFILE SUMMARY", "Summary"],
    ["PROFESSIONAL EXPERIENCE", "Work Experience"],
    ["KEY SKILLS", "Skills"],
    ["QUALIFICATIONS", "Education"],
    ["ACADEMIC PROJECTS/TRAINING", "Projects"],
    ["AWARDS & ACHIEVEMENTS", "Awards"],
    ["POSITIONS OF RESPONSIBILITY", "Leadership"],
    ["EXTRA-CURRICULARS", "Interests"],
    ["LANGUAGES KNOWN", "Languages"],
  ])("%s → %s, recognised as standard", (heading, canonical) => {
    const h = classifyHeading(heading)!;
    expect(h.standard).toBe(true);
    expect(canonicalSection(h.key, heading)).toBe(canonical);
  });
  it("finds exactly the nine sections, none merged and none at half credit", async () => {
    const { r } = await synthetic;
    expect([...sectionSet(r)].sort()).toEqual([...EXPECTED_SECTIONS].sort());
    expect(r.resume.sections.every((s) => s.standard)).toBe(true);
    expect(r.resume.sections.some((s) => /EXPERIENCE KEY SKILLS/.test(s.heading))).toBe(false);
  });
});

describe("Bug 3: only Work Experience lines are scored as bullets", () => {
  const check = async (r: Awaited<typeof synthetic>["r"]) => {
    const audit = r.bulletAudit;
    expect(audit).toHaveLength(7);
    expect(audit.filter((b) => b.strongVerb).length / audit.length).toBe(1);
    expect(audit.filter((b) => b.hasMetric).length / audit.length).toBeGreaterThanOrEqual(0.85);
    const NOT_EXPERIENCE = /^(AGILE\/SCRUM DELIVERY|Community Service|Esports|Member \||Top Performer|Star of the Year|English|Hindi|GENAI|Partner Performance Index|Built API-integrated)/;
    for (const b of audit) expect(b.text).not.toMatch(NOT_EXPERIENCE);
  };
  it("synthetic two-column PDF: 7 bullets, 100% action verbs, ≥85% with metrics", async () => check((await synthetic).r));
});

describe("Bug 4: roles, years and seniority", () => {
  const facts = (r: Awaited<typeof synthetic>["r"]) => {
    expect(r.resume.roles).toHaveLength(3);
    expect(r.resume.roles.map((x) => x.company)).toEqual(["Brightpath", "Lumenly", "Northwind Games"]);
    expect(r.resume.totalYears).toBeGreaterThanOrEqual(6.2);
    expect(r.resume.totalYears).toBeLessThanOrEqual(6.4);
    expect(r.explanations.experienceAlignment.find((e) => e.label.startsWith("Seniority"))?.value).toMatch(/You read as Senior\b/);
    expect(r.diagnostics.find((d) => d.id === "section-roles")).toMatchObject({ status: "pass" });
  };
  it("synthetic PDF: 3 roles (the Senior QA role is back), about 6.3 years, Senior", async () => facts((await synthetic).r));

  it("when stated experience and dated roles disagree, it says so and doesn't downgrade seniority", async () => {
    const text = [
      "Alex Doe",
      "Experience: 75 Months",
      "SUMMARY",
      "Product manager with platform and analytics experience across B2B products.",
      "EXPERIENCE",
      "Product QA, Brightpath May 2024 - Sep 2025",
      "• Cut reporting time from 1 hour to 5 minutes for a 4-member team",
      "• Shipped usage-based pricing to 40 enterprise customers in two quarters",
    ].join("\n");
    const r = await analyze(parseText(text), JD_TEXT, { useLLM: false });
    expect(r.resume.totalYears).toBeLessThan(2);
    expect(r.diagnostics.find((d) => d.id === "section-roles")).toMatchObject({ status: "warn" });
    expect(r.diagnostics.find((d) => d.id === "section-roles")!.detail).toMatch(/Could not parse all roles/);
    expect(r.warnings.join(" ")).toMatch(/Could not parse all roles/);
    expect(r.explanations.experienceAlignment.find((e) => e.label.startsWith("Seniority"))?.value).toMatch(/You read as Senior\b/);
    expect(buildClaudeReport(r)).toMatch(/Role-count check: WARNING/);
  });
});

describe("Bug 5: name from the largest text near the top, PDF and .docx alike", () => {
  it("synthetic PDF: the 21pt name on the same row as 'Experience: 75 Months' is found", async () => {
    const { doc, r } = await synthetic;
    expect(doc.nameHint).toBe("ANANYA RAO");
    expect(r.resume.contact.name?.toLowerCase()).toBe("ananya rao");
    expect(r.diagnostics.find((d) => d.id === "contact-name")?.status).toBe("pass");
  });
  it("labels and headings are never taken as the name", async () => {
    const doc = await parseResumeFile(twoColumnResumePdf({ noName: true }), "noname.pdf");
    expect(doc.nameHint).toBeNull();
    expect(parseResume(doc.text, doc.links, doc.nameHint).contact.name).toBeNull();
  });
});

describe("Bug 6: rewrites only for Work Experience lines", () => {
  const OTHER_SECTIONS = /GENAI|PROJECT MANAGEMENT|AGILE\/SCRUM|Top Performer|Star of the Year|Member \||Community Service|Esports|English - |Hindi - /;
  const check = (r: Awaited<typeof synthetic>["r"]) => {
    const exp = new Set(r.bulletAudit.map((b) => b.text));
    for (const i of r.bulletPointImprovements) {
      expect(exp.has(i.original), i.original).toBe(true);
      expect(i.original).not.toMatch(OTHER_SECTIONS);
      expect(unsafeSuggestion(i.original, i.suggested)).toBeNull();
      if (hasNumber(i.original) || metricOptional(i.original)) expect(i.suggested).not.toMatch(/\[X%\]/);
      expect(i.swaps?.length).toBeGreaterThan(0);
    }
    for (const p of r.keywordPlacements) if (p.targetBullet) expect(exp.has(p.targetBullet)).toBe(true);
    expect(r.bulletAudit.find((b) => /^Aligned CXO/.test(b.text))?.metricOptional).toBe(true);
  };
  it("synthetic PDF: no suggestion for Skills, Awards, Positions or Interests lines", async () => check((await synthetic).r));
});

describe("Bug 7: PDF artifacts (spacing, margins, logo, link annotations)", () => {
  it('normalises "Product QA , Brightpath" and never flags PDF spacing as grammar', async () => {
    const { doc, r } = await synthetic;
    expect(doc.text).toContain("Product QA, Brightpath");
    expect(doc.text).not.toMatch(/ ,/);
    expect(r.writing!.issues.some((i) => i.text === "space before punctuation")).toBe(false);
  });
  it("margins come from the content bounding box of the words, with the source named", async () => {
    const { doc } = await synthetic;
    expect(doc.layout.page?.marginSource).toMatch(/content bounding box from word coordinates/);
    expect(doc.layout.page?.marginConfidence).not.toBe("high");
    expect(doc.layout.page?.margins?.left).toBeGreaterThan(20); // text starts at x=24, not at the page edge
  });
  it("one logo in the header band, clear of text, is a low finding; an image over text is not", async () => {
    const run = async (logo: "header" | "over-text") => {
      const doc = await parseResumeFile(twoColumnResumePdf({ logo }), "Ananya-Rao-Resume.pdf");
      const r = await analyze(doc, JD_TEXT, { useLLM: false });
      return { doc, finding: r.formattingIssues.flatMap((i) => i.items ?? [i]).find((i) => i.id === "images") };
    };
    const head = await run("header");
    expect(head.doc.layout.images).toEqual([expect.objectContaining({ headerBand: true, overlapsText: false })]);
    expect(head.finding?.severity).toBe("low");
    const over = await run("over-text");
    expect(over.doc.layout.images?.[0].overlapsText).toBe(true);
    expect(over.finding?.severity).toBe("medium");
  });
  it("a mailto: link annotation reports an email; a 'Portfolio' link is web presence", async () => {
    const doc = await parseResumeFile(twoColumnResumePdf({ mailto: "mailto:ananya@example.com", portfolio: "https://ananya-rao.netlify.app/" }), "r.pdf");
    expect(doc.links).toEqual(expect.arrayContaining(["mailto:ananya@example.com", "https://ananya-rao.netlify.app/"]));
    const r = await analyze(doc, JD_TEXT, { useLLM: false });
    expect(r.resume.contact.email).toBe("ananya@example.com");
    expect(r.contactPresence!.find((x) => x.field === "email")).toMatchObject({ where: "link target" });
    expect(r.diagnostics.find((d) => d.id === "web-presence")?.detail).toMatch(/Portfolio ✓/);
  });
});

describe("Bug 8: parse confidence and knockout verdicts", () => {
  it("columns detected and everything parsed → medium, with the reason named", async () => {
    const { r } = await synthetic;
    expect(r.parseConfidence?.level).toBe("medium");
    expect(r.parseConfidence?.reasons).toContain("two-column layout (read column by column)");
    expect(r.knockouts?.status).not.toBe("unverified");
  });
  it("name not found → low: 'could not verify, check extracted text' plus a layout warning, never auto-reject", async () => {
    const doc = await parseResumeFile(twoColumnResumePdf({ noName: true }), "r.pdf");
    const r = await analyze(doc, JD_TEXT, { useLLM: false });
    expect(r.parseConfidence?.level).toBe("low");
    expect(r.knockouts?.status).toBe("unverified");
    expect(KNOCKOUT_VERDICT[r.knockouts!.status]).toBe("could not verify, check extracted text");
    expect(r.warnings.join(" ")).toMatch(/Scores for this file may reflect layout rather than content/);
  });
  it("roles parsed vs stated experience disagree → low", async () => {
    const text = "Alex Doe\nExperience: 75 Months\nSUMMARY\nProduct manager with platform and analytics experience across B2B products.\nEXPERIENCE\nProduct QA, Brightpath May 2024 - Sep 2025\n• Cut reporting time from 1 hour to 5 minutes for a 4-member team\n• Shipped usage-based pricing to 40 enterprise customers in two quarters";
    const r = await analyze(parseText(text), JD_TEXT, { useLLM: false });
    expect(r.parseConfidence?.level).toBe("low");
    expect(r.parseConfidence?.reasons.join(" ")).toMatch(/could not parse all roles/);
    expect(r.knockouts?.status).not.toBe("likely-reject");
  });
  it("a resume that states fewer years than its dated roles is not a parse failure", async () => {
    const text = "Alex Doe\nSUMMARY\nProduct manager with 2 years of experience in B2B platforms and analytics.\nEXPERIENCE\nProduct QA, Brightpath Jan 2015 - Sep 2025\n• Cut reporting time from 1 hour to 5 minutes for a 4-member team\n• Shipped usage-based pricing to 40 enterprise customers in two quarters";
    const r = await analyze(parseText(text), JD_TEXT, { useLLM: false });
    expect(r.parseConfidence?.reasons.join(" ")).not.toMatch(/could not parse all roles/);
  });
});

describe("Deliverable 4: PDF / .docx parity", () => {
  // A single-column .docx with exactly the synthetic PDF's content (name in a header table,
  // the qualifications as a real table), so parity doesn't depend on files on this machine.
  const twinDocx = () =>
    buildDocx({
      header: tbl(tr(tc(p("Age | Gender: 27y | F"), p("Experience: 75 Months")), tc(p("ANANYA RAO", { size: 21, bold: true })))),
      body: [
        p("PROFILE SUMMARY"),
        p(SUMMARY),
        ...resumeParagraphs().left.map(([t, kind]) => p(kind === "b" ? `• ${t}` : t)),
        p("QUALIFICATIONS"),
        tbl(tr(...["Degree", "Institute/ University/ City", "%/CGPA", "Year"].map((c) => tc(p(c)))), ...EDUCATION_ROWS.map((row) => tr(...row.map((c) => tc(p(c)))))),
        ...RIGHT.flatMap(([h, items]) => [p(h), ...items.map((i) => p(`• ${i}`))]),
      ].join(""),
    });
  const facts = (r: Awaited<typeof synthetic>["r"]) => ({
    sections: [...r.resume.sections.filter((s) => s.key !== "contact").map((s) => s.canonical)].sort(),
    bullets: r.bulletAudit.length,
    roles: r.resume.roles.length,
    name: r.resume.contact.name?.toLowerCase(),
  });
  const sameExceptFormatting = (a: Awaited<typeof synthetic>["r"], b: Awaited<typeof synthetic>["r"]) => {
    for (const k of ["hardSkills", "experienceAlignment", "sectionStructure", "bulletImpact"] as const) expect(a.categoryScores[k], k).toBe(b.categoryScores[k]);
    // Whatever differs overall must come from the formatting category alone.
    const w = a.weights.formattingHealth / 100;
    expect(Math.abs(a.overallScore - b.overallScore)).toBeLessThanOrEqual(Math.ceil(Math.abs(a.categoryScores.formattingHealth - b.categoryScores.formattingHealth) * w) + 1);
  };
  it("synthetic: the PDF and its .docx twin give the same sections, bullets, roles and name", async () => {
    const { r: pdf } = await synthetic;
    const docx = await analyze(await parseResumeFile(await twinDocx(), "Ananya-Rao-Resume.docx"), JD_TEXT, { useLLM: false });
    expect(facts(pdf)).toEqual(facts(docx));
    expect(facts(pdf)).toMatchObject({ bullets: 7, roles: 3, name: "ananya rao" });
    sameExceptFormatting(pdf, docx);
  });
});

describe("Deliverable 3: --show-extracted on a two-column PDF", () => {
  it("prints reading-order text, sections, roles with dates, the name and the education rows", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "resumefit-"));
    const file = path.join(dir, "two-col.pdf");
    writeFileSync(file, twoColumnResumePdf());
    const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/ats-cli.ts", file, "--show-extracted"], { encoding: "utf8", timeout: 120_000 });
    rmSync(dir, { recursive: true, force: true });
    expect(out).toMatch(/^name:\s+ANANYA RAO/m);
    expect(out).toMatch(/SECTIONS \(in reading order\)/);
    expect(out).toMatch(/^Work Experience\s+← "PROFESSIONAL EXPERIENCE"/m);
    expect(out).toMatch(/^Languages\s+← "LANGUAGES KNOWN"/m);
    expect(out).toMatch(/^Senior QA \| Northwind Games \| Jun 2019-Mar 2022$/m);
    expect(out).toMatch(/^MBA \(PGPM\) \| Westbrook School of Management, Pune \| 3\.20\/4 \| 2027$/m);
    expect(out).toMatch(/EXTRACTED TEXT in reading order \(columns read left, then right/);
    expect(out).toContain(FELLO_BULLET);
  }, 120_000);
});
