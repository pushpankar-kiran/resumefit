// Regression tests for the 10 bugs found on a real PGPM resume + Accenture JD.
// They assert facts (what was parsed, matched, flagged), never overall scores.
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile, parseText } from "@/lib/parsers";
import { jdEducation, resumeEducation } from "@/lib/nlp/education";
import { structureJDHeuristic } from "@/lib/nlp/jd";
import { screenKnockouts } from "@/lib/nlp/knockouts";
import { CREDIT, matchKeywords } from "@/lib/nlp/matcher";
import { parseResume } from "@/lib/nlp/resume";
import { heuristicRewrites, substituteKeyword } from "@/lib/nlp/suggest";
import { hasMetric, hasNumber } from "@/lib/nlp/verbs";
import { analyzeWriting } from "@/lib/nlp/writing";
import { findingIds, groupFindings } from "@/lib/scoring/findings";
import type { JDKeyword, StructuredJD } from "@/lib/types";

const NEXT_YEAR = new Date().getFullYear() + 1;
// Real-length experience text (analyze() rejects resumes under 200 characters).
const BODY =
  "EXPERIENCE\nProduct Manager | Acme | Jan 2020 - Present\n• Shipped usage-based pricing to 40 enterprise customers in two quarters\n" +
  "• Ran 12 A/B tests on onboarding, lifting activation from 31% to 44%\n• Wrote PRDs and user stories for a 6-person engineering team\n";

// ---------- Synthetic .docx built in memory ----------

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';
const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const cell = (t: string) => `<w:tc><w:tcPr/>${p(t)}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;
// A floating text box the way Word saves it: DrawingML in Choice, a VML copy in Fallback,
// plus numeric anchor offsets that are not text.
const textBox = (t: string) =>
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor>` +
  `<wp:positionH relativeFrom="column"><wp:posOffset>-269874</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="paragraph"><wp:posOffset>914400</wp:posOffset></wp:positionV>` +
  `<wp14:sizeRelH relativeFrom="margin"><wp14:pctWidth>0</wp14:pctWidth></wp14:sizeRelH>` +
  `<wps:wsp><wps:txbx><w:txbxContent>${p(t)}</w:txbxContent></wps:txbx></wps:wsp>` +
  `</wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${p(t)}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>
${p("Alex Doe")}
<w:p><w:hyperlink r:id="rIdMail"><w:r><w:t>Email</w:t></w:r></w:hyperlink></w:p>
${textBox("Batch of 2026-27")}
${p("PROFILE SUMMARY")}
${p("Product manager with six years in B2B platforms.")}
${p("PROFESSIONAL EXPERIENCE")}
${p("Product Manager | Acme | Jan 2020 - Present")}
${p("• Cut report turnaround from 1 hour to 5 minutes for a 4-member analytics team")}
${p("QUALIFICATIONS")}
<w:tbl><w:tblPr/>${row("MBA", "Westbrook School of Management", String(NEXT_YEAR))}${row("B. Tech.", "Delhi Technological University", "2019")}</w:tbl>
<w:sectPr/></w:body></w:document>`;

const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${NS}>
<w:p><w:hyperlink r:id="rIdLi"><w:r><w:t>LinkedIn</w:t></w:r></w:hyperlink></w:p>
</w:hdr>`;

const rels = (items: [string, string][]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>`)
    .join("")}</Relationships>`;

async function syntheticDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", DOCUMENT);
  zip.file("word/header1.xml", HEADER);
  zip.file("word/_rels/document.xml.rels", rels([["rIdMail", "mailto:alex.doe@example.com"]]));
  zip.file("word/_rels/header1.xml.rels", rels([["rIdLi", "https://www.linkedin.com/in/alexdoe"]]));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("1. docx parsing", () => {
  it("reads text boxes once (Choice only), drops drawing offsets, reads link targets and table rows", async () => {
    const doc = await parseResumeFile(await syntheticDocx(), "alex.docx");
    expect(doc.text).not.toMatch(/-269874|914400/);
    expect(doc.text.split("\n").some((l) => /^-?\d+$/.test(l.trim()))).toBe(false);
    expect(doc.text.match(/Batch of 2026-27/g)).toHaveLength(1);
    expect(doc.links).toContain("mailto:alex.doe@example.com");
    expect(doc.links).toContain("https://www.linkedin.com/in/alexdoe");
    expect(doc.text).toContain(`MBA | Westbrook School of Management | ${NEXT_YEAR}`);
    expect(doc.text).toContain("B. Tech. | Delhi Technological University | 2019");

    const r = parseResume(doc.text, doc.links);
    expect(r.contact.email).toBe("alex.doe@example.com");
    expect(r.contact.linkedin).toMatch(/linkedin\.com\/in\/alexdoe/);
  });
});

describe("2. education", () => {
  it("knows degree abbreviations and returns the highest level first", () => {
    const r = parseResume(`Alex Doe\nEDUCATION\nPGPM | Westbrook | ${NEXT_YEAR}\nB. Tech. (MAE) | DTU | 2019\n12th | Greenfield School | 2014`);
    const e = resumeEducation(r);
    expect(e[0]).toMatchObject({ level: 4, degree: "PGPM", year: NEXT_YEAR, inProgress: true });
    expect(e.find((x) => x.degree === "B. Tech.")).toMatchObject({ level: 3, year: 2019, inProgress: false });
    expect(e.find((x) => x.degree === "12th")?.level).toBe(1);
  });
  it("marks a future graduation year as in progress", () => {
    const e = resumeEducation(parseResume(`EDUCATION\nMBA, State University, ${NEXT_YEAR}`));
    expect(e[0].inProgress).toBe(true);
  });
});

const ACCENTURE_STYLE_JD = `Role: Program and Product Manager
About Accenture: Accenture is a global professional services company with leading capabilities in digital, cloud and security. Visit us at www.accenture.com or https://www.accenture.com/careers
Main responsibilities:
• Coordinate cross-functional teams across Technology, Facilities, Procurement, Information Security, and Operations to ensure alignment
• Build a ROI-driven product roadmap and manage the product backlog
Key Attributes:
• Experience working with Agile and SCRUM
Education: Master's degree in management, Computer Science, Engineering, or related field.
Core Competencies:
• Backend system (Relational and/or document based, big data is plus)
Preference:
• Minimum 5+ years in a Product management environment
Joining Location: Bangalore
Disclaimer(s):
• Accenture's criterion for hiring is merit. Send details to india.fc.check@accenture.com or https://businessethicsline.com/accenture`;

describe("3. JD parsing", () => {
  const jd = structureJDHeuristic(ACCENTURE_STYLE_JD);
  const terms = jd.keywords.map((k) => k.term.toLowerCase());
  it("never extracts keywords from URLs, emails, About, Disclaimer or department lists", () => {
    expect(terms).not.toContain("http");
    expect(terms).not.toContain("https");
    expect(terms).not.toContain("security"); // only in About + a list of departments
  });
  it("classifies 'is plus' as nice-to-have and Preference years as preferred", () => {
    expect(jd.keywords.find((k) => k.term === "Big Data")?.priority).toBe("nice");
    expect(jd.keywords.find((k) => k.term === "Agile")?.priority).toBe("must");
    expect(jd.experienceYears).toBe(5);
    expect(jd.experiencePreferred).toBe(true);
  });
  it("reads the degree from the Education line", () => {
    expect(jd.education).toMatchObject({ level: 4, required: true });
    expect(jdEducation("Education: Master’s degree in management or related field.")?.level).toBe(4);
  });
});

describe("4. headings", () => {
  it("maps synonyms to standard sections and ignores table rows and degree fragments", () => {
    const r = parseResume(
      [
        "Alex Doe",
        "PROFILE SUMMARY",
        "Product manager with six years in B2B platforms.",
        "PROFESSIONAL EXPERIENCE",
        "Product Manager | Acme | Jan 2020 - Present",
        "• Shipped pricing",
        "ACADEMIC PROJECTS",
        "• Built a churn model",
        "AWARDS & ACHIEVEMENTS",
        "• Top Performer | Acme | 2024",
        "POSITIONS OF RESPONSIBILITY",
        "• Placement committee member",
        "QUALIFICATIONS",
        "PGPM | Westbrook | 2027",
        "B. Tech. (MAE) | DTU | 2019",
      ].join("\n"),
    );
    const heads = r.sections.filter((s) => s.key !== "contact");
    expect(heads.every((s) => s.standard)).toBe(true);
    expect(r.sections.find((s) => s.heading === "PROFILE SUMMARY")?.key).toBe("summary");
    expect(r.sections.find((s) => s.heading === "QUALIFICATIONS")?.key).toBe("education");
    expect(heads.some((s) => /PGPM|\(MAE\)|\|/.test(s.heading))).toBe(false);
  });
});

describe("5. findings grouped by root cause, penalty capped", () => {
  it("reports missing contact details once and caps the penalty", () => {
    const g = groupFindings(
      [
        { id: "missing-email", severity: "high", issue: "No email", recommendation: "" },
        { id: "missing-phone", severity: "high", issue: "No phone", recommendation: "" },
        { id: "missing-linkedin", severity: "medium", issue: "No LinkedIn", recommendation: "" },
      ],
      [
        { id: "missing-email", label: "", points: 10 },
        { id: "missing-phone", label: "", points: 8 },
        { id: "missing-linkedin", label: "", points: 4 },
      ],
    );
    expect(g.issues).toHaveLength(1);
    expect(g.issues[0].id).toBe("cause-contact");
    expect(g.issues[0].items).toHaveLength(3);
    expect(g.breakdown[0]).toMatchObject({ raw: 22, applied: 15 });
  });
  it("has no separate 'Contact Info section' check", async () => {
    const r = await analyze(parseText(`Alex Doe\nSUMMARY\nProduct manager.\n${BODY}EDUCATION\nMBA, State University, 2018\nSKILLS\nSQL, Jira`), "", {});
    const all = r.formattingIssues.flatMap((i) => [i, ...(i.items ?? [])]);
    expect(all.some((i) => /contact info(rmation)? section/i.test(i.issue))).toBe(false);
    expect(r.formattingIssues.filter((i) => i.id === "cause-contact")).toHaveLength(1);
    expect(findingIds(r.formattingIssues)).toContain("missing-email");
  });
});

describe("6. metrics", () => {
  it.each([
    "Cut report turnaround from 1 hour to 5 minutes",
    "Led a 4-member squad through the launch",
    "Raised NPS from 32 to 51",
    "Reduced page load from 4.1s to 1.6s",
  ])("detects a metric in %s", (b) => expect(hasMetric(b)).toBe(true));
  it("doesn't invent one", () => {
    expect(hasMetric("Worked with teams on weekly reports")).toBe(false);
    expect(hasMetric("Improved onboarding, lifting activation by [X%]")).toBe(false);
  });
});

const kw = (term: string, category: JDKeyword["category"] = "hard_skill"): JDKeyword => ({ term, aliases: [], category, priority: "must" });

describe("7. keyword matching tiers and evidence", () => {
  const r = parseResume(
    [
      "EXPERIENCE",
      "PM | Acme | Jan 2020 - Present",
      "• Managed key stakeholders across 3 regions",
      "• Wrote PRDs for the platform team",
      "• Built reporting on MySQL",
      "SKILLS",
      "RISK MANAGEMENT",
      "PROGRAM GOVERNANCE",
      "Product management",
    ].join("\n"),
  );
  const m = Object.fromEntries(
    matchKeywords([kw("Manage Stakeholders", "soft_skill"), kw("Product Requirements Document"), kw("PostgreSQL", "tool"), kw("Program Management"), kw("Project Management")], r).map((x) => [x.term, x]),
  );
  it("matches inflected forms as the word-form tier with evidence", () => {
    expect(m["Manage Stakeholders"].matchType).toBe("word-form");
    expect(m["Manage Stakeholders"].credit).toBe(CREDIT["word-form"]);
    expect(m["Manage Stakeholders"].evidence).toMatch(/Managed key stakeholders/);
  });
  it("uses the alias file", () => {
    expect(m["Product Requirements Document"].matchType).toBe("alias");
    expect(m["Product Requirements Document"].evidence).toMatch(/PRDs/);
  });
  it("gives a sibling tool partial credit only", () => {
    expect(m["PostgreSQL"].matchType).toBe("related");
    expect(m["PostgreSQL"].credit).toBe(CREDIT.related);
    expect(CREDIT.related).toBeLessThanOrEqual(0.3);
    expect(m["PostgreSQL"].evidence).toMatch(/MySQL/);
  });
  it("never matches across lines or a different real word", () => {
    // "RISK MANAGEMENT" + next line "PROGRAM GOVERNANCE" is not "program management", and
    // "Product management" is not "Project Management". At most same-family partial credit.
    for (const t of ["Program Management", "Project Management"]) {
      expect(["exact", "alias", "word-form", "semantic"]).not.toContain(m[t].matchType);
      expect(m[t].credit).toBeLessThanOrEqual(CREDIT.related);
    }
  });
});

const JD_BASE: StructuredJD = { targetTitle: null, keywords: [], responsibilities: [], experienceYears: null, education: null, source: "heuristic" } as unknown as StructuredJD;

describe("8. knockout confidence", () => {
  it("in-progress degree is a medium-confidence risk, not a fail", () => {
    const r = parseResume(`EDUCATION\nPGPM | Westbrook | ${NEXT_YEAR}\nB. Tech. | DTU | 2019`);
    const k = screenKnockouts("", { ...JD_BASE, education: { level: 4, label: "Master's degree", required: true, equivalentExperienceOk: false, fields: [] } }, r, []);
    expect(k.checks[0]).toMatchObject({ id: "degree", status: "risk", confidence: "medium" });
    expect(k.status).toBe("review");
  });
  it("unreadable degree is 'unable to verify', not a knockout", () => {
    const r = parseResume("EDUCATION\nWestbrook School of Management, Pune\nBatch of 2026-27");
    const k = screenKnockouts("", { ...JD_BASE, education: { level: 4, label: "Master's degree", required: true, equivalentExperienceOk: false, fields: [] } }, r, []);
    expect(k.checks[0]).toMatchObject({ status: "unverifiable", confidence: "low" });
    expect(k.status).not.toBe("likely-reject");
  });
  it("undated roles can't be verified; preferred years never fail", () => {
    const undated = parseResume("EXPERIENCE\nProduct Manager | Acme\n• Shipped pricing");
    expect(screenKnockouts("", { ...JD_BASE, experienceYears: 5 }, undated, []).checks[0].status).toBe("unverifiable");
    const junior = parseResume("EXPERIENCE\nAnalyst | Acme | Jan 2024 - Present\n• Built dashboards");
    const pref = screenKnockouts("", { ...JD_BASE, experienceYears: 8, experiencePreferred: true }, junior, []).checks[0];
    expect(pref.status).toBe("risk");
    expect(screenKnockouts("", { ...JD_BASE, experienceYears: 8 }, junior, []).checks[0].status).toBe("fail");
  });
  it("every check carries a confidence", async () => {
    const r = await analyze(parseText(`Alex Doe\n${BODY}EDUCATION\nMBA, State U, 2018`), ACCENTURE_STYLE_JD, { useLLM: false });
    for (const c of r.knockouts!.checks) expect(["high", "medium", "low"]).toContain(c.confidence);
  });
});

describe("9. rewrites", () => {
  const jd = structureJDHeuristic(ACCENTURE_STYLE_JD);
  it("never adds placeholders to a bullet that already has a number", () => {
    for (const b of ["Cut report turnaround from 1 hour to 5 minutes for a 4-member team", "Mentored two junior analysts", "Grew revenue 18% in FY24"]) {
      expect(hasNumber(b)).toBe(true);
      for (const o of heuristicRewrites(b, ["Big Data", "Tableau"], jd)) expect(o).not.toMatch(/\[[^\]]*\]/);
    }
  });
  it("substitutes words instead of appending clauses", () => {
    expect(substituteKeyword("Built dashboards for the sales team", "Tableau")).toBe("Built Tableau dashboards for the sales team");
    expect(substituteKeyword("Built pipelines for finance", "Data Pipelines")).toBe("Built data pipelines for finance");
    expect(substituteKeyword("Aligned release priorities with leadership", "Kubernetes")).toBeNull();
    for (const o of heuristicRewrites("Owned the roadmap for three products", ["OKRs", "Monetization"], jd)) expect(o).not.toMatch(/, supporting |\b(using|with) (OKRs|monetization)\b/i);
  });
});

describe("10. spellcheck allowlist", () => {
  it("doesn't flag brands, British spellings or the JD's own words", async () => {
    const r = parseResume(
      "SUMMARY\nProduct manager.\nEXPERIENCE\nPM | Acme | Jan 2020 - Present\n• Launched Esports tournaments and deployed the portfolio on Netlify\n• Optimised Confluence and Jira workflows for hyperautomation\n• Fixed managment reports",
    );
    const w = await analyzeWriting(r, ["Hyperautomation"]);
    const flagged = w.issues.filter((i) => i.kind === "spelling").map((i) => i.text.toLowerCase());
    for (const ok of ["esports", "netlify", "optimised", "confluence", "hyperautomation"]) expect(flagged).not.toContain(ok);
    expect(flagged).toContain("managment");
  });
});
