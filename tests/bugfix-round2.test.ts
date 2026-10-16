// Second round of real-file bugs (a PGPM student's resume + an Accenture-style JD). One describe
// block per bug; every test asserts extracted facts, never score values.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile, parseText } from "@/lib/parsers";
import { skillItems } from "@/lib/nlp/atsview";
import { structureJDHeuristic } from "@/lib/nlp/jd";
import { heuristicRewrites } from "@/lib/nlp/suggest";
import { hasNumber, metricOptional, quantifyVague } from "@/lib/nlp/verbs";
import { analyzeWriting } from "@/lib/nlp/writing";
import { buildClaudeReport } from "@/lib/report";
import { isNameLike, parseResume } from "@/lib/nlp/resume";
import { resumeEducation } from "@/lib/nlp/education";
import { CREDIT, matchKeywords } from "@/lib/nlp/matcher";
import type { JDKeyword, ParsedDocument, StructuredJD } from "@/lib/types";
import { KNOCKOUT_VERDICT, parseConfidence, screenKnockouts } from "@/lib/nlp/knockouts";
import { buildDocx, hyperlink, p, sectPr, tbl, tc, textBox, tr } from "./helpers/docx";
import { findingIds } from "@/lib/scoring/findings";

// A shortened version of the Accenture JD (structure and wording kept).
const ACCENTURE_STYLE_JD_LITE = `Role: Program and Product Management
About Accenture: Accenture is a global professional services company with leading capabilities in digital, cloud and security.
Main responsibilities:
• Build a ROI-driven product roadmap and manage the product backlog with effective prioritization
• Communicate and build consensus across multiple departments in creating the software product requirements
Key Attributes:
• Experience working with Agile and SCRUM
Education: Master's degree in management, Computer Science, Engineering, or related field.
Core Competencies:
• Good understanding of Cloud computing and Artificial Intelligence APIs
Preference:
• Minimum 5+ years in a Product management environment`;

// A header table like the real resume: labels in one cell, the name (bold 20pt) in another;
// the body opens with a bulleted skill list.
const headerTable = tbl(tr(tc(p("Age | Gender: 27 y | F"), p("Experience: 75 months")), tc(p("ANANYA RAO", { size: 20, bold: true }))));
const skillBody = [
  p("PROFILE SUMMARY"),
  p("Product management professional turning business challenges into scalable AI solutions."),
  p("KEY SKILLS"),
  p("• DIGITAL TRANSFORMATION"),
  p("• PROJECT MANAGEMENT"),
  p("• CLOUD & AI APIs"),
  textBox(p("FT100200 Batch of 2026-27")),
].join("");

describe("Bug 1: name", () => {
  it("rejects skill phrases and headings, accepts a real name", () => {
    for (const s of ["DIGITAL TRANSFORMATION", "PROJECT MANAGEMENT", "CLOUD & AI APIs", "KEY SKILLS", "Product Manager"]) expect(isNameLike(s), s).toBe(false);
    expect(isNameLike("ANANYA RAO")).toBe(true);
    expect(isNameLike("Ananya Rao")).toBe(true);
  });
  it("finds the bold, large name in a header table cell, never a skill line or drawing offsets", async () => {
    const doc = await parseResumeFile(await buildDocx({ header: headerTable, body: skillBody }), "r.docx");
    expect(doc.nameHint).toBe("ANANYA RAO");
    expect(doc.text).not.toMatch(/-269874/);
    expect(doc.text.match(/Batch of 2026-27/g)).toHaveLength(1);
    expect(parseResume(doc.text, doc.links, doc.nameHint).contact.name?.toLowerCase()).toBe("ananya rao");
  });
  it("a plain read that skips the header finds no name rather than a skill", () => {
    const naive = parseResume("PROFILE SUMMARY\nProduct manager.\nKEY SKILLS\n• DIGITAL TRANSFORMATION\n• PROJECT MANAGEMENT");
    expect(naive.contact.name).toBeNull();
  });
});

describe("Bug 2: one education parser for every view", () => {
  const NEXT = new Date().getFullYear() + 1;
  // Qualifications table inside a text box, as on the real resume.
  const body = [
    p("Alex Doe"),
    p("SUMMARY"),
    p("Product manager with six years of platform experience across B2B and consumer products."),
    p("EXPERIENCE"),
    p("Product Manager | Acme | Jan 2020 - Present"),
    p("• Shipped usage-based pricing to 40 enterprise customers"),
    p("QUALIFICATIONS"),
    textBox(
      tbl(
        tr(tc(p("Degree")), tc(p("Institute")), tc(p("Year"))),
        tr(tc(p("PGPM")), tc(p("Westbrook School of Management, Pune")), tc(p(String(NEXT)))),
        tr(tc(p("B. Tech. (MAE)")), tc(p("Delhi Technological University")), tc(p("2019"))),
        tr(tc(p("12th")), tc(p("Greenfield Public School, Nagpur")), tc(p("2014"))),
      ),
    ),
  ].join("");

  it.each([
    ["PGPM, Westbrook, 2027", 4],
    ["PGDM | IIM Lucknow | 2020", 4],
    ["MBA, Stanford University, 2018", 4],
    ["B.Tech, IIT Delhi, 2015", 3],
    ["B. Tech. (MAE) | DTU | 2019", 3],
    ["B.E. Mechanical Engineering, Anna University, 2016", 3],
    ["BSc Physics, Delhi University, 2014", 3],
    ["B.Com, St. Xavier's College, 2013", 3],
    ["M.Tech, IIT Bombay, 2017", 4],
    ["MSc Data Science, University of Leeds, 2021", 4],
    ["MA Economics, JNU, 2012", 4],
    ["PhD, MIT, 2020", 5],
  ])("recognises %s", (line, level) => {
    expect(resumeEducation(parseResume(`EDUCATION\n${line}`))[0]?.level).toBe(level);
  });

  it("reads the table rows, returns the highest level, marks a future year in progress", async () => {
    const doc = await parseResumeFile(await buildDocx({ body }), "r.docx");
    expect(doc.text).toContain(`PGPM | Westbrook School of Management, Pune | ${NEXT}`);
    const e = resumeEducation(parseResume(doc.text));
    expect(e[0]).toMatchObject({ degree: "PGPM", level: 4, year: NEXT, inProgress: true, status: "in progress" });
    expect(e.find((x) => x.degree === "B. Tech.")).toMatchObject({ level: 3, status: "completed" });
  });

  it("the ATS view and the experience check report the same degree", async () => {
    const doc = await parseResumeFile(await buildDocx({ body }), "r.docx");
    const r = await analyze(doc, "Requirements:\n- Master's degree in management required\n- 5+ years of product management experience with roadmaps, pricing and stakeholder management", { useLLM: false });
    const ats = r.atsView.fields.find((f) => f.label === "Education")!;
    expect(ats.value).toMatch(/Master's degree \(PGPM, expected \d{4}\), in progress/);
    expect(ats.note ?? "").not.toMatch(/No degree recognized/);
    expect(r.explanations.experienceAlignment.find((x) => x.label.startsWith("Education"))?.value).toMatch(/Master's degree in progress/);
  });

});

describe("Bug 3: alias file, word forms, tiers and evidence", () => {
  const resume = parseResume(
    [
      "KEY SKILLS",
      "• CLOUD & AI APIs",
      "EXPERIENCE",
      "QA Lead | Lumenly | Mar 2022 - May 2024",
      "• Aligned stakeholders on fragmented release priorities in Jira",
      "• Owned the backlog as user stories and acceptance criteria",
      "• Prioritised defects with the support team and managed stakeholders weekly",
      "• Directed a phased customer experience redesign",
      "• Built reporting on MySQL",
    ].join("\n"),
  );
  const kw = (term: string, category: JDKeyword["category"] = "hard_skill"): JDKeyword => ({ term, aliases: [], category, priority: "must" });
  const m = Object.fromEntries(
    matchKeywords(
      ["Cloud Computing", "Prioritization", "Requirements Gathering", "Customer Focus", "Manage Stakeholders", "PostgreSQL", "Change Management"].map((t) => kw(t)),
      resume,
    ).map((x) => [x.term, x]),
  );

  it("the alias file is data, with the seeded entries", () => {
    const file = JSON.parse(readFileSync("src/lib/nlp/aliases.json", "utf8"));
    expect(file.variants["Cloud Computing"]).toEqual(expect.arrayContaining(["cloud", "cloud & ai apis", "aws", "azure", "gcp"]));
    expect(file.variants["Prioritization"]).toEqual(expect.arrayContaining(["prioritiz*", "prioritis*", "release priorities"]));
    for (const k of ["Requirements Gathering", "Project Management", "Change Management", "Customer Focus"]) expect(file.variants[k], k).toBeDefined();
  });
  it('"CLOUD & AI APIs" matches Cloud Computing via alias, with evidence', () => {
    expect(m["Cloud Computing"]).toMatchObject({ matchType: "alias", credit: 1 });
    expect(m["Cloud Computing"].evidence).toBe("[CLOUD] & AI APIs");
  });
  it("wildcard and phrase variants match", () => {
    expect(m["Prioritization"].matchType).toBe("alias");
    expect(m["Requirements Gathering"]).toMatchObject({ matchType: "alias" });
    expect(m["Requirements Gathering"].evidence).toMatch(/user stories/);
    expect(m["Customer Focus"].evidence).toMatch(/customer experience/);
  });
  it("variants are one-way: 'cloud' never satisfies AWS", () => {
    const aws = matchKeywords([kw("AWS", "tool")], parseResume("SKILLS\nCloud computing, cloud & AI APIs")).at(0)!;
    expect(["exact", "alias"]).not.toContain(aws.matchType);
  });
  it("word forms match as the word-form tier; related is partial only", () => {
    expect(m["Manage Stakeholders"]).toMatchObject({ matchType: "word-form", credit: CREDIT["word-form"] });
    expect(m["PostgreSQL"]).toMatchObject({ matchType: "related", credit: CREDIT.related });
    expect(CREDIT.related).toBeLessThan(CREDIT.semantic);
    for (const x of Object.values(m)) if (x.credit > 0) expect(x.evidence, x.term).toBeTruthy();
  });
});

describe("Bug 4: contact details searched everywhere, absent vs could-not-read, one penalty", () => {
  const filler = [
    p("SUMMARY"),
    p("Product manager with six years of platform experience across B2B and consumer products."),
    p("EXPERIENCE"),
    p("Product Manager | Acme | Jan 2020 - Present"),
    p("• Shipped usage-based pricing to 40 enterprise customers in two quarters"),
    p("• Ran 12 A/B tests on onboarding, lifting activation from 31% to 44%"),
    p("EDUCATION"),
    p("MBA, State University, 2018"),
  ].join("");
  const run = async (opts: Parameters<typeof buildDocx>[0]) => {
    const doc = await parseResumeFile(await buildDocx(opts), "Alex-Doe-Resume.docx");
    return analyze(doc, "", {});
  };
  const state = (r: Awaited<ReturnType<typeof run>>, f: string) => r.contactPresence!.find((x) => x.field === f)!;

  it("a mailto: hyperlink is detected as the email (link target)", async () => {
    const r = await run({ body: p("Alex Doe") + hyperlink("rIdMail", "Email me") + filler, bodyLinks: [["rIdMail", "mailto:alex.doe@example.com"]] });
    expect(r.resume.contact.email).toBe("alex.doe@example.com");
    expect(state(r, "email")).toMatchObject({ state: "hard to read", where: "link target" });
    expect(findingIds(r.formattingIssues)).not.toContain("missing-email");
  });
  it("finds LinkedIn in the header's link targets, and an email inside a text box", async () => {
    const r = await run({
      header: hyperlink("rIdLi", "LinkedIn"),
      headerLinks: [["rIdLi", "https://www.linkedin.com/in/alexdoe"]],
      body: p("Alex Doe") + textBox(p("alex.doe@example.com | +91 98765 43210")) + filler,
    });
    expect(r.resume.contact.linkedin).toContain("linkedin.com/in/alexdoe");
    expect(state(r, "email")).toMatchObject({ state: "hard to read", where: "table or text box" });
    expect(state(r, "phone").value).toBeTruthy();
  });
  it("finds a phone in the footer", async () => {
    const r = await run({ body: p("Alex Doe") + filler, footer: p("+1 (415) 555-0134") });
    expect(state(r, "phone")).toMatchObject({ where: "header/footer" });
  });
  it("tells 'absent' from 'could not read'", async () => {
    const r = await run({ body: p("Alex Doe") + p("Email: | Phone: ") + filler });
    expect(state(r, "email").state).toBe("could not read");
    expect(state(r, "phone").state).toBe("could not read");
    expect(state(r, "linkedin").state).toBe("absent");
    const ids = findingIds(r.formattingIssues);
    expect(ids).toEqual(expect.arrayContaining(["unreadable-email", "unreadable-phone", "missing-linkedin"]));
    expect(ids).not.toContain("missing-email");
  });
  it("all contact findings sit under one root cause with one capped penalty", async () => {
    const r = await run({ body: p("Alex Doe") + filler });
    expect(r.formattingIssues.filter((i) => i.id === "cause-contact")).toHaveLength(1);
    const contactRows = r.explanations.formattingHealth.filter((e) => /contact/i.test(e.label));
    expect(contactRows).toHaveLength(1);
  });
});

describe("Bug 5: margins come from w:sectPr / w:pgMar in every section", () => {
  const indentedTable = `<w:tbl><w:tblPr><w:tblInd w:w="-1200" w:type="dxa"/></w:tblPr>${tr(tc(p("PGPM")), tc(p("2027")))}</w:tbl>`;
  it("ignores table indents and reports the source", async () => {
    const doc = await parseResumeFile(
      await buildDocx({ body: p("Alex Doe") + indentedTable, finalSectPr: sectPr({ top: 1440, right: 1440, bottom: 1440, left: 1440 }) }),
      "r.docx",
    );
    expect(doc.layout.page?.margins).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
    expect(doc.layout.page?.marginSource).toMatch(/w:pgMar in 1 section/);
    expect(doc.layout.page?.marginConfidence).toBe("high");
  });
  it("reads all sections; low confidence when they differ", async () => {
    const first = `<w:p><w:pPr>${sectPr({ top: 1440, right: 1440, bottom: 1440, left: 1440 })}</w:pPr></w:p>`;
    const doc = await parseResumeFile(
      await buildDocx({ body: p("Alex Doe") + first + p("Page two"), finalSectPr: sectPr({ top: 720, right: 360, bottom: 720, left: 720 }) }),
      "r.docx",
    );
    expect(doc.layout.page?.sectionMargins).toHaveLength(2);
    expect(doc.layout.page?.margins).toEqual({ top: 36, right: 18, bottom: 36, left: 36 });
    expect(doc.layout.page?.marginConfidence).toBe("low");
  });
});

describe("Bug 6: skills count, keep-layout prompt, substitution-only rewrites, metric optional, spellcheck", () => {
  const SKILL_BLOCK = ["KEY SKILLS", "• PROJECT MANAGEMENT", "• PRODUCT ROADMAP & BACKLOG", "• GEN AI AGENT DEVELOPMENT", "• CLOUD & AI APIs", "• RISK MANAGEMENT", "• PROGRAM GOVERNANCE", "• AGILE/SCRUM DELIVERY"];
  const ALIGN = "Aligned CXO and cross-functional stakeholders on fragmented release priorities in Jira, escalating and mitigating go-live risks";
  const resumeText = [
    "Alex Doe",
    "PROFILE SUMMARY",
    "Product management professional turning business challenges into scalable AI solutions.",
    ...SKILL_BLOCK,
    "PROFESSIONAL EXPERIENCE",
    "Product QA | Brightpath | May 2024 – Sep 2025",
    `• ${ALIGN}`,
    "• Owned product backlog as user stories, cutting manual reporting time from 1 hour to 5 minutes",
    "• Onboarded several enterprise clients onto the analytics tool",
    "• Responsible for weekly release notes for the product team",
    "QUALIFICATIONS",
    "PGPM | Westbrook School of Management, Pune | 3.20/4 | 2027",
  ].join("\n");
  const analyzed = analyze(parseText(resumeText, "alex.txt"), ACCENTURE_STYLE_JD_LITE, { useLLM: false });

  it("counts every item in the Key Skills block (7)", async () => {
    expect(skillItems(SKILL_BLOCK.slice(1))).toHaveLength(7);
    expect(skillItems(["Python, SQL; Tableau | Jira"])).toEqual(["Python", "SQL", "Tableau", "Jira"]);
    const r = await analyzed;
    expect(r.atsView.fields.find((f) => f.label === "Skills list")!.value).toMatch(/^7 skills listed/);
  });

  it("keep-layout prompt asks for word swaps only, no restructure, no word-count increase", async () => {
    const r = await analyzed;
    const normal = buildClaudeReport(r);
    const keep = buildClaudeReport(r, undefined, { keepLayout: true });
    expect(normal).toMatch(/single column/);
    const instructions = keep.slice(0, keep.indexOf("## Score"));
    expect(instructions).toMatch(/KEEP-LAYOUT MODE/);
    expect(instructions).toMatch(/Do NOT rewrite or restructure/);
    expect(instructions).not.toMatch(/Use an ATS-safe format: a single column/);
    expect(instructions).toMatch(/Word swaps/);
    const words = (r.resume.text.match(/\S+/g) ?? []).length;
    expect(instructions).toContain(`it is ${words} words now, and must be ${words} or fewer`);
  });

  it("rewrites only substitute words: no appended clauses, no [X%] on numbered bullets", () => {
    const jd = structureJDHeuristic(ACCENTURE_STYLE_JD_LITE);
    for (const b of [ALIGN, "Owned product backlog as user stories, cutting manual reporting time from 1 hour to 5 minutes", "Responsible for weekly release notes for the product team", "Managed 4-member team owning UAT"]) {
      const APPENDED = /, (improving|achieving|cutting|lifting|supporting) |Drove measurable impact|Delivered \[X%\]/g;
      const clauses = (s: string) => (s.match(APPENDED) ?? []).length;
      for (const o of heuristicRewrites(b, ["Prioritization", "Requirements Gathering"], jd)) {
        // The bullet's own wording may already contain ", cutting ..."; nothing new is added.
        expect(clauses(o), o).toBeLessThanOrEqual(clauses(b));
        if (hasNumber(b)) expect(o).not.toMatch(/\[[^\]]*\]/);
        // No added clause: never more words than the original plus a keyword's few words.
        expect((o.match(/\S+/g) ?? []).length).toBeLessThanOrEqual((b.match(/\S+/g) ?? []).length + 3);
      }
    }
    expect(quantifyVague("Onboarded several enterprise clients onto the analytics tool")).toBe("Onboarded [N] enterprise clients onto the analytics tool");
    expect(quantifyVague("Managed 4-member team owning UAT")).toBeNull();
  });

  it('alignment/risk bullets are "metric optional" and never get a placeholder', async () => {
    expect(metricOptional(ALIGN)).toBe(true);
    expect(metricOptional("Onboarded several enterprise clients onto the analytics tool")).toBe(false);
    expect(quantifyVague("Coordinated several vendors to mitigate go-live risks")).toBeNull();
    const r = await analyzed;
    expect(r.bulletAudit.find((b) => b.text === ALIGN)?.metricOptional).toBe(true);
    for (const i of r.bulletPointImprovements) {
      if (i.original === ALIGN) {
        expect(i.suggested).not.toMatch(/\[/);
        expect(i.reason).toMatch(/metric optional/);
      }
    }
  });

  it("spellcheck allows JD words and Esports, Jira, Confluence, Odoo", async () => {
    const r = parseResume("SUMMARY\nProduct manager.\nEXPERIENCE\nPM | Acme | Jan 2020 - Present\n• Ran Esports leagues, tracked work in Jira and Confluence, migrated finance to Odoo for hyperautomation\n• Fixed managment reports");
    const flagged = (await analyzeWriting(r, ["Hyperautomation"])).issues.filter((i) => i.kind === "spelling").map((i) => i.text.toLowerCase());
    for (const ok of ["esports", "jira", "confluence", "odoo", "hyperautomation"]) expect(flagged).not.toContain(ok);
    expect(flagged).toContain("managment");
  });

});

describe("Bug 7: knockout confidence; low parse confidence never means auto-reject", () => {
  const MASTERS: StructuredJD = {
    targetTitle: null,
    keywords: [],
    responsibilities: [],
    experienceYears: null,
    education: { level: 4, label: "Master's degree", required: true, equivalentExperienceOk: false, fields: [] },
    source: "heuristic",
  } as unknown as StructuredJD;
  const bachelorOnly = parseResume("EXPERIENCE\nAnalyst | Acme | Jan 2020 - Present\n• Built dashboards\nEDUCATION\nB.Tech, IIT Delhi, 2015");
  const layout = (o: Partial<ParsedDocument["layout"]>) => ({ columns: 1, hasTables: false, hasTextBoxes: false, imageCount: 0, headerFooterText: "", pageCount: 1, typography: null, page: null, hiddenTextChars: 0, ...o }) as ParsedDocument["layout"];
  const longText = "word ".repeat(200);

  it("rates parse confidence from the file's layout", () => {
    expect(parseConfidence({ text: longText, layout: layout({}) }).level).toBe("high");
    expect(parseConfidence({ text: longText, layout: layout({ hasTables: true, hasTextBoxes: true }) })).toMatchObject({ level: "medium", reasons: ["text boxes", "tables"] });
    expect(parseConfidence({ text: longText, layout: layout({ columns: 2 }) }, 40).level).toBe("low");
    expect(parseConfidence({ text: "Alex Doe", layout: layout({}) }).level).toBe("low");
  });
  it("a confident failure is still a likely auto-reject", () => {
    const k = screenKnockouts("", MASTERS, bachelorOnly, [], { level: "high", reasons: [] });
    expect(k.checks[0]).toMatchObject({ id: "degree", status: "fail", confidence: "high" });
    expect(k.status).toBe("likely-reject");
  });
  it('the same failure on a low-confidence parse is "could not verify, check extracted text"', () => {
    const k = screenKnockouts("", MASTERS, bachelorOnly, [], { level: "low", reasons: ["multi-column layout scrambles the plain-text read"] });
    expect(k.checks[0]).toMatchObject({ status: "unverifiable", confidence: "low" });
    expect(k.checks[0].advice).toMatch(/check the extracted text/);
    expect(k.status).toBe("unverified");
    expect(k.status).not.toBe("likely-reject");
    expect(k.summary).toMatch(/Could not verify/);
    expect(k.summary).toMatch(/Check the extracted text/i);
    expect(KNOCKOUT_VERDICT[k.status]).toBe("could not verify, check extracted text");
  });
  it("a check is never more confident than the parse", () => {
    const k = screenKnockouts("", MASTERS, bachelorOnly, [], { level: "medium", reasons: ["tables"] });
    for (const c of k.checks) expect(["medium", "low"]).toContain(c.confidence);
  });
});

describe("Deliverable 3: CLI --show-extracted and --keep-layout", () => {
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/ats-cli.ts", ...args], { encoding: "utf8", timeout: 120_000 });
  it("prints the extracted text, the plain ATS read and the link targets", () => {
    const out = cli("fixtures/resume-risky.docx", "--jd", "fixtures/dev-jd.txt", "--show-extracted");
    expect(out).toMatch(/====\s*EXTRACTED TEXT/);
    expect(out).toMatch(/====\s*PLAIN ATS READ/);
    expect(out).toMatch(/====\s*HYPERLINK TARGETS/);
    expect(out).toMatch(/knockout screen: /);
  }, 120_000);
  it("--keep-layout writes a word-swap-only report", () => {
    const file = path.join(os.tmpdir(), `ats-keep-${process.pid}.md`);
    cli("fixtures/pm-resume.txt", "--jd", "fixtures/pm-jd.txt", "--keep-layout", "--report", file);
    const md = readFileSync(file, "utf8");
    expect(md).toMatch(/KEEP-LAYOUT MODE/);
    expect(md.slice(0, md.indexOf("## 1."))).not.toMatch(/Use an ATS-safe format: a single column/);
    rmSync(file);
  }, 120_000);
});
