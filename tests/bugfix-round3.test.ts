// Third round of real-file bugs. One describe block per bug; every test asserts extracted facts
// (names, tiers, evidence, states), never score values.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile, parseText } from "@/lib/parsers";
import { nameProblem, parseResume, parseRoles } from "@/lib/nlp/resume";
import { describeEducation, highestDegree, resumeEducation } from "@/lib/nlp/education";
import { buildDocx, hyperlink, p, tbl, tc, tr } from "./helpers/docx";
import { hasHeadEvidence, headLemmas, matchKeywords, relatedSiblingsOf } from "@/lib/nlp/matcher";
import { lemma } from "@/lib/nlp/text";
import { buildClaudeReport } from "@/lib/report";
import { unsafeSuggestion, wordDelta, wordSwaps } from "@/lib/nlp/swaps";
import { heuristicRewrites } from "@/lib/nlp/suggest";
import { structureJDHeuristic } from "@/lib/nlp/jd";
import type { JDKeyword, ParsedDocument, StructuredJD } from "@/lib/types";
import { KNOCKOUT_VERDICT, parseConfidence, screenKnockouts } from "@/lib/nlp/knockouts";

const BODY_TAIL = [
  p("PROFESSIONAL EXPERIENCE"),
  p("Product QA, Brightpath May 2024 – Sep 2025"),
  p("• Owned product backlog as user stories and acceptance criteria, cutting reporting time from 1 hour to 5 minutes"),
  p("QUALIFICATIONS"),
  p("PGPM | Westbrook School of Management, Pune | 3.20/4 | 2027"),
].join("");
// Header table like the real resume: labels in one cell, the bold 20pt name in another.
const HEADER = tbl(tr(tc(p("Age | Gender: 27 y | F"), p("Experience: 75 months"), p("Portfolio")), tc(p("ANANYA RAO", { size: 20, bold: true }))));
const withSkills = (skills: string[]) =>
  buildDocx({ header: HEADER, body: [p("PROFILE SUMMARY"), p("Product management professional."), p("KEY SKILLS"), ...skills.map((s) => p(`• ${s}`)), BODY_TAIL].join("") });

describe("Bug 1: candidate name", () => {
  it("validates a name: headings, skill phrases, labels, JD keywords and single words fail", () => {
    expect(nameProblem("ANANYA RAO")).toBeNull();
    expect(nameProblem("Ananya Rao")).toBeNull();
    expect(nameProblem("PROJECT MANAGEMENT")).toMatch(/skill phrase/);
    expect(nameProblem("DIGITAL TRANSFORMATION")).toMatch(/skill phrase/);
    expect(nameProblem("KEY SKILLS")).toMatch(/section heading/);
    expect(nameProblem("KIRAN")).toMatch(/fewer than 2/);
    expect(nameProblem("Age Gender")).toMatch(/label/);
    expect(nameProblem("Agile Coach", ["Agile Coach"])).toMatch(/keyword from the job description/);
    expect(nameProblem(null)).toMatch(/no name/);
  });

  it("the Name check FAILS when the value is a skill phrase", async () => {
    // A resume whose only capitalised top line is a skill: the check must not pass.
    const r = await analyze(
      parseText("DIGITAL TRANSFORMATION\nPROFILE SUMMARY\nProduct management professional turning business challenges into scalable AI solutions through product strategy.\nPROFESSIONAL EXPERIENCE\nProduct QA | Brightpath | May 2024 - Sep 2025\n• Owned product backlog as user stories and acceptance criteria, cutting reporting time from 1 hour to 5 minutes"),
      "",
      {},
    );
    expect(r.resume.contact.name).toBeNull();
    expect(r.diagnostics.find((d) => d.id === "contact-name")?.status).toBe("fail");
  });

  it("finds the name in the header table cell next to Age | Gender | Experience", async () => {
    const doc = await parseResumeFile(await withSkills(["PROJECT MANAGEMENT", "CLOUD & AI APIs"]), "r.docx");
    expect(parseResume(doc.text, doc.links, doc.nameHint).contact.name?.toLowerCase()).toBe("ananya rao");
  });

  it("editing the Key Skills list never changes the name", async () => {
    const lists = [
      ["DIGITAL TRANSFORMATION", "PROJECT MANAGEMENT"],
      ["PROJECT MANAGEMENT", "PRODUCT ROADMAP & BACKLOG", "CLOUD COMPUTING & AI APIs"],
      ["Stakeholder Management", "Agile Delivery", "Risk Management", "Program Governance"],
      [],
    ];
    const names = await Promise.all(
      lists.map(async (l) => {
        const doc = await parseResumeFile(await withSkills(l), "r.docx");
        return parseResume(doc.text, doc.links, doc.nameHint).contact.name;
      }),
    );
    expect(new Set(names)).toEqual(new Set(["ANANYA RAO"]));
  });

  it("never takes the name from below the first section heading", async () => {
    // No header; the only big bold short line sits under PROFILE SUMMARY.
    const doc = await parseResumeFile(await buildDocx({ body: [p("PROFILE SUMMARY"), p("Jane Smith", { size: 20, bold: true }), p("Product manager."), BODY_TAIL].join("") }), "r.docx");
    expect(parseResume(doc.text, doc.links, doc.nameHint).contact.name).toBeNull();
  });

});

describe("Bug 2: one shared education parser", () => {
  const NEXT = new Date().getFullYear() + 1;
  it("reads table rows as cell | cell | cell, branch suffixes included, highest level first", async () => {
    const doc = await parseResumeFile(
      await buildDocx({
        body: [
          p("QUALIFICATIONS"),
          tbl(
            tr(tc(p("Degree")), tc(p("Institute")), tc(p("Year"))),
            tr(tc(p("12th")), tc(p("Greenfield Public School, Nagpur")), tc(p("2014"))),
            tr(tc(p("B. Tech. (MAE)")), tc(p("Riverside Institute of Technology")), tc(p("2019"))),
            tr(tc(p("PGPM")), tc(p("Westbrook School of Management")), tc(p(String(NEXT)))),
          ),
        ].join(""),
      }),
      "r.docx",
    );
    expect(doc.text).toContain("B. Tech. (MAE) | Riverside Institute of Technology | 2019");
    const e = resumeEducation(parseResume(doc.text));
    expect(highestDegree(e)).toMatchObject({ degree: "PGPM", level: 4, status: "in progress", year: NEXT });
    expect(e.find((x) => x.degree === "B. Tech.")).toMatchObject({ level: 3, school: false });
    expect(e.find((x) => x.degree === "12th")).toMatchObject({ level: 1, school: true });
  });
  it("10th / 12th rows are school entries, never the highest degree", () => {
    const e = resumeEducation(parseResume("EDUCATION\n12th | Greenfield Public School | 2014\n10th | Greenfield Public School | 2012"));
    expect(e.every((x) => x.school)).toBe(true);
    expect(highestDegree(e)).toBeNull();
  });
  it.each([
    ["PGDM | IIM Lucknow | 2020", 4],
    ["B.E. (Mech) | Anna University | 2016", 3],
    ["M.Tech (CSE), IIT Bombay, 2017", 4],
    ["BSc (Hons) Physics, Delhi University, 2014", 3],
    ["MSc, University of Leeds, 2021", 4],
    ["PhD, MIT, 2020", 5],
  ])("recognises %s", (line, level) => expect(highestDegree(resumeEducation(parseResume(`EDUCATION\n${line}`)))?.level).toBe(level));
});

describe("Bug 3: no credit without evidence", () => {
  const RESUME_TEXT = [
    "KEY SKILLS",
    "• PROJECT MANAGEMENT",
    "• PRODUCT ROADMAP & BACKLOG",
    "PROFILE SUMMARY",
    "Product management professional turning business challenges into scalable AI solutions through product strategy, ROI-driven roadmap ownership, team leadership and stakeholder management.",
    "PROFESSIONAL EXPERIENCE",
    "Product QA | Brightpath | May 2024 - Sep 2025",
    "• Led redesign of a stagnant lead conversion process, from business case to go-live, via design thinking, as-is/to-be mapping and fit-gap analysis",
    "• Owned product backlog as user stories and acceptance criteria for an analytics tool",
    "• Aligned CXO and cross-functional stakeholders on prioritizing fragmented release in Jira, escalating and mitigating go-live risks",
    "• Built reporting on MySQL",
  ].join("\n");
  const kw = (term: string, category: JDKeyword["category"]): JDKeyword => ({ term, aliases: [], category, priority: "must" });
  const m = Object.fromEntries(
    matchKeywords(
      [
        kw("Time Management", "soft_skill"),
        kw("Problem Solving", "soft_skill"),
        kw("Strategic Thinking", "soft_skill"),
        kw("Change Management", "hard_skill"),
        kw("Communication", "soft_skill"),
        kw("Requirements Gathering", "hard_skill"),
        kw("Prioritization", "hard_skill"),
        kw("PostgreSQL", "tool"),
      ],
      parseResume(RESUME_TEXT),
    ).map((x) => [x.term, x]),
  );

  it("head words: generic words like 'management' never count", () => {
    expect(headLemmas("Time Management")).toEqual([lemma("time")]);
    expect(headLemmas("Problem Solving")).toEqual([lemma("problem"), lemma("solving")]);
    expect(hasHeadEvidence("Time Management", "prioritizing fragmented release")).toBe(false);
    expect(hasHeadEvidence("Problem Solving", "solved a pricing problem")).toBe(true);
    expect(hasHeadEvidence("Strategic Thinking", "product strategy, team leadership")).toBe(false);
  });
  it('"Time Management" is NOT matched from the alignment bullet', () => expect(m["Time Management"]).toMatchObject({ matchType: "none", credit: 0 }));
  it('"Problem Solving" is NOT matched from design thinking / fit-gap analysis', () => expect(m["Problem Solving"].matchType).toBe("none"));
  it('"Strategic Thinking" is NOT matched from "product strategy … team leadership"', () => expect(m["Strategic Thinking"].matchType).toBe("none"));
  it('"Change Management" is not credited from "PROJECT MANAGEMENT"', () => {
    expect(m["Change Management"]).toMatchObject({ matchType: "none", credit: 0 });
    expect(m["Communication"].matchType).toBe("none"); // "stakeholder management" isn't a listed sibling
  });
  it("related = a sibling listed in the alias file, capped at 30%", () => {
    expect(m["PostgreSQL"]).toMatchObject({ matchType: "related" });
    expect(m["PostgreSQL"].credit).toBeLessThanOrEqual(0.3);
    expect(relatedSiblingsOf(["Change Management"])).toEqual([]);
    expect(relatedSiblingsOf(["PostgreSQL"])).toContain("mysql");
  });
  it("explicitly listed alias phrases still match, and evidence brackets the matched words", () => {
    expect(m["Requirements Gathering"]).toMatchObject({ matchType: "alias", evidence: "Owned product backlog as [user stories] and acceptance criteria for an analytics tool" });
    expect(m["Prioritization"].evidence).toMatch(/\[prioritizing\]/);
    for (const x of Object.values(m)) if (x.credit > 0) expect(x.evidence, x.term).toMatch(/\[[^\]]+\]/);
  });
});

describe("Bug 4: aliases from the config file, word forms at full credit, mention counts", () => {
  it("the seeded aliases live in aliases.json", () => {
    const v = JSON.parse(readFileSync("src/lib/nlp/aliases.json", "utf8")).variants;
    expect(v["Requirements Gathering"]).toEqual(["requirements", "user stories", "acceptance criteria", "requirement analysis", "requirements documentation"]);
    expect(v["Cloud Computing"]).toEqual(expect.arrayContaining(["cloud", "cloud computing", "aws", "azure", "gcp"]));
    expect(v["Change Management"]).toEqual(["change management", "change adoption"]);
    expect(v["Customer Focus"]).toEqual(["customer-centric", "customer-focused", "customer experience"]);
  });
  it("prioritize / prioritizing / prioritization / prioritise and release / releases share a lemma", () => {
    expect(new Set(["prioritize", "prioritizing", "prioritization", "prioritise", "prioritisation", "prioritized"].map(lemma)).size).toBe(1);
    expect(new Set(["release", "releases", "released"].map(lemma)).size).toBe(1);
  });
  const resume = parseResume(
    "EXPERIENCE\nProduct QA | Brightpath | May 2024 - Sep 2025\n• Owned product backlog as user stories and acceptance criteria for an analytics tool\n• Aligned stakeholders on prioritizing fragmented releases in Jira\n• Prioritized the defect backlog weekly",
  );
  const kw = (term: string): JDKeyword => ({ term, aliases: [], category: "hard_skill", priority: "must" });
  const m = Object.fromEntries(matchKeywords([kw("Requirements Gathering"), kw("Prioritization"), kw("Release Prioritization")], resume, {}, "Prioritization prioritization prioritization").map((x) => [x.term, x]));
  it("Requirements Gathering matches via alias from 'user stories and acceptance criteria'", () => {
    expect(m["Requirements Gathering"]).toMatchObject({ matchType: "alias", credit: 1 });
    expect(m["Requirements Gathering"].resumeCount).toBeGreaterThanOrEqual(2); // user stories + acceptance criteria
  });
  it("Prioritization mentions >= 1, and other word forms earn full word-form credit", () => {
    expect(m["Prioritization"].resumeCount).toBeGreaterThanOrEqual(1);
    expect(m["Release Prioritization"]).toMatchObject({ matchType: "word-form", credit: 1 });
    expect(m["Release Prioritization"].resumeCount).toBeGreaterThanOrEqual(1);
  });
  it("'Emphasized in the JD but light on the resume' uses the same count", async () => {
    const r = await analyze(
      parseText(`Alex Doe\nSUMMARY\nProduct manager.\n${["EXPERIENCE", "Product QA | Brightpath | May 2024 - Sep 2025", "• Aligned stakeholders on prioritizing fragmented releases in Jira and Confluence", "• Owned the backlog as user stories with acceptance criteria for an analytics tool", "• Cut reporting time from 1 hour to 5 minutes for a 4-member team"].join("\n")}`),
      "Responsibilities:\n- Effective prioritization of features\n- Help prioritize resources\n- Prioritization of the backlog with business teams\n- Gather product requirements from stakeholders",
      { useLLM: false },
    );
    const p = r.keywords.details.find((k) => k.term === "Prioritization")!;
    expect(p.resumeCount).toBeGreaterThanOrEqual(1);
    const md = buildClaudeReport(r);
    if (p.resumeCount < p.jdCount) expect(md).toContain(`- Prioritization: JD ${p.jdCount}×, resume ${p.resumeCount}×`);
  });
});

describe("Bug 5: safe rewrite suggestions", () => {
  const FELLO_ALIGN = "Aligned CXO and cross-functional stakeholders on prioritizing fragmented release in Jira, escalating and mitigating go-live risks";
  it("rejects appended clauses and placeholders on numbered or alignment/risk bullets", () => {
    expect(unsafeSuggestion(FELLO_ALIGN, `${FELLO_ALIGN}, improving [key metric] by [X%]`)).toMatch(/alignment\/risk|placeholder/);
    expect(unsafeSuggestion("Managed 4-member team owning UAT", "Managed 4-member team owning UAT, achieving [X%]")).toMatch(/already has a number/);
    expect(unsafeSuggestion("Owned the product backlog for an analytics tool", "Owned the product backlog for an analytics tool, supporting requirements gathering")).toMatch(/appends a clause|short insertion/);
    expect(unsafeSuggestion("Responsible for weekly release notes", "Wrote weekly release notes")).toBeNull();
    expect(unsafeSuggestion("Built dashboards for the sales team", "Built Tableau dashboards for the sales team")).toBeNull();
  });
  it("shows a suggestion as old → new swaps with the word-count delta", () => {
    expect(wordSwaps("Responsible for weekly release notes", "Wrote weekly release notes")).toEqual([{ from: "Responsible for", to: "Wrote" }]);
    expect(wordDelta("Responsible for weekly release notes", "Wrote weekly release notes")).toBe(-1);
    expect(wordSwaps("Built dashboards for sales", "Built Tableau dashboards for sales")).toEqual([{ from: "", to: "Tableau" }]);
  });
  it("no suggestion for the Brightpath alignment bullet contains [X%]", async () => {
    const r = await analyze(
      parseText(`Alex Doe\nSUMMARY\nProduct manager.\nEXPERIENCE\nProduct QA | Brightpath | May 2024 - Sep 2025\n• ${FELLO_ALIGN}\n• Responsible for weekly release notes for the product team\n• Cut reporting time from 1 hour to 5 minutes for a 4-member team`),
      "Responsibilities:\n- Prioritization of the backlog with business teams\n- Requirements gathering from stakeholders\n- Agile delivery with cross-functional teams",
      { useLLM: false },
    );
    for (const i of r.bulletPointImprovements) {
      if (i.original === FELLO_ALIGN) expect(i.suggested).not.toMatch(/\[X%\]|\[key metric\]/);
      expect(unsafeSuggestion(i.original, i.suggested)).toBeNull();
      expect(i.swaps?.length).toBeGreaterThan(0);
      expect(typeof i.wordDelta).toBe("number");
    }
    expect(r.bulletAudit.find((b) => b.text === FELLO_ALIGN)?.metricOptional).toBe(true);
    for (const o of heuristicRewrites(FELLO_ALIGN, ["Time Management"], structureJDHeuristic("Responsibilities:\n- Time management"))) expect(o).not.toMatch(/\[/);
  });
  it("keep-layout prompt: no single column, no renamed headings, word swaps only, no new skills", async () => {
    const r = await analyze(parseText(`Alex Doe\nSUMMARY\nProduct manager.\nEXPERIENCE\nProduct QA | Brightpath | May 2024 - Sep 2025\n• ${FELLO_ALIGN}\n• Cut reporting time from 1 hour to 5 minutes for a 4-member team\nSKILLS\nJira, Confluence`), "Requirements:\n- Agile delivery and SQL for 5+ years in product management roles\n- Requirements gathering, prioritization and stakeholder management across business teams", { useLLM: false });
    const md = buildClaudeReport(r, undefined, { keepLayout: true });
    const prompt = md.slice(0, md.indexOf("## 1."));
    expect(prompt).not.toMatch(/Use an ATS-safe format: a single column/);
    expect(prompt).not.toMatch(/standard headings \(Professional Summary/);
    expect(prompt).toMatch(/no renaming or reordering headings/);
    expect(prompt).toMatch(/diff-only list of word swaps/);
    expect(prompt).toMatch(/total word count must not increase/);
    expect(prompt).toMatch(/Do not add any skill, tool or keyword unless it already appears somewhere in my resume/);
  });
});

describe("Bug 6: contact detection, web presence and margins", () => {
  const filler = [
    p("PROFILE SUMMARY"),
    p("Product management professional turning business challenges into scalable AI solutions."),
    p("PROFESSIONAL EXPERIENCE"),
    p("Product QA | Brightpath | May 2024 - Sep 2025"),
    p("• Owned product backlog as user stories and acceptance criteria, cutting reporting time from 1 hour to 5 minutes"),
    p("• Managed 4-member team owning UAT, resolving 90% of complaints"),
  ].join("");
  const run = async (opts: Parameters<typeof buildDocx>[0]) => analyze(await parseResumeFile(await buildDocx(opts), "Ananya-Rao-Resume.docx"), "", {});
  const check = (r: Awaited<ReturnType<typeof run>>, id: string) => r.diagnostics.find((d) => d.id === id)!;

  it("a mailto: hyperlink reports an email", async () => {
    const r = await run({ body: p("Alex Doe") + hyperlink("rIdMail", "Email") + filler, bodyLinks: [["rIdMail", "mailto:alex.doe@example.com"]] });
    expect(r.resume.contact.email).toBe("alex.doe@example.com");
    expect(r.contactPresence!.find((x) => x.field === "email")).toMatchObject({ where: "link target", value: "alex.doe@example.com" });
  });
  it('"Contact info in body" fails when email and phone are both absent', async () => {
    const r = await run({ body: p("Alex Doe") + filler });
    expect(check(r, "contact-header")).toMatchObject({ status: "fail" });
    expect(check(r, "contact-header").detail).toMatch(/No email or phone anywhere/);
    expect(r.contactPresence!.map((x) => x.state)).toEqual(["absent", "absent", "absent"]);
  });
  it('a "Portfolio" link label counts as web presence', async () => {
    const r = await run({ header: hyperlink("rIdP", "Portfolio"), headerLinks: [["rIdP", "https://ananya-rao.netlify.app/"]], body: p("Alex Doe") + filler });
    expect(check(r, "web-presence").detail).toMatch(/Portfolio ✓/);
  });
  it('"could not read" stays separate from "absent"', async () => {
    const r = await run({ body: p("Alex Doe") + p("Email: | Phone: ") + filler });
    expect(r.contactPresence!.find((x) => x.field === "email")?.state).toBe("could not read");
    expect(r.contactPresence!.find((x) => x.field === "linkedin")?.state).toBe("absent");
  });
});

describe("Bug 7: knockout confidence follows name, education and contact parsing", () => {
  const MASTERS = {
    targetTitle: null,
    keywords: [],
    responsibilities: [],
    experienceYears: 5,
    education: { level: 4, label: "Master's degree", required: true, equivalentExperienceOk: false, fields: [] },
    source: "heuristic",
  } as unknown as StructuredJD;
  const plainLayout = { columns: 1, hasTables: false, hasTextBoxes: false, imageCount: 0, headerFooterText: "", pageCount: 1, typography: null, page: null, hiddenTextChars: 0 } as ParsedDocument["layout"];
  const doc = { text: "word ".repeat(200), layout: plainLayout };
  const junior = parseResume("EXPERIENCE\nAnalyst | Acme | Jan 2024 - Present\n• Built dashboards\nEDUCATION\nB.Tech, IIT Delhi, 2015");

  it.each([
    ["name", { nameProblem: '"PROJECT MANAGEMENT" is a skill phrase' }],
    ["education", { educationUnreadable: true }],
    ["contact", { contactUnreadable: ["email"] }],
  ])("low %s confidence → 'could not verify, check extracted text', never auto-reject", (_, fields) => {
    const parse = parseConfidence(doc, 100, fields);
    expect(parse.level).toBe("low");
    const k = screenKnockouts("", MASTERS, junior, [], parse);
    expect(k.status).toBe("unverified");
    expect(KNOCKOUT_VERDICT[k.status]).toBe("could not verify, check extracted text");
    expect(k.summary).toMatch(/Check the extracted text/i);
    for (const c of k.checks) {
      expect(c.confidence).toBe("low");
      expect(c.status).not.toBe("fail");
    }
  });
  it("with confident parsing, the same resume is still a likely auto-reject (no masking)", () => {
    expect(screenKnockouts("", MASTERS, junior, [], parseConfidence(doc, 100)).status).toBe("likely-reject");
  });
  it("every knockout row shows its confidence in the report", async () => {
    const r = await analyze(
      parseText(
        "Alex Doe\nSUMMARY\nProduct manager with platform and analytics experience.\nEXPERIENCE\nAnalyst | Acme | Jan 2024 - Present\n• Cut reporting time from 1 hour to 5 minutes for a 4-member team\n• Shipped usage-based pricing to 40 enterprise customers in two quarters\nEDUCATION\nB.Tech, IIT Delhi, 2015",
      ),
      "Requirements:\n- Master's degree in management is required\n- 5+ years of product management experience with roadmaps and stakeholder management",
      { useLLM: false },
    );
    const md = buildClaudeReport(r);
    expect(md).toMatch(/\| Check \| Status \| Confidence \|/);
    for (const c of r.knockouts!.checks) expect(md).toContain(`| ${c.label} |`);
    for (const c of r.knockouts!.checks) expect(["high", "medium", "low"]).toContain(c.confidence);
  });
});

describe("Deliverable 3: --show-extracted prints the fields the ATS sees", () => {
  it("prints name, contact, education, skills and the extracted text", () => {
    const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/ats-cli.ts", "fixtures/pm-resume.txt", "--jd", "fixtures/pm-jd.txt", "--show-extracted"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    for (const label of [/^name:\s/m, /^email:\s/m, /^phone:\s/m, /^linkedin:\s/m, /^education:\s/m, /^skills:\s/m, /parse confidence:/, /EXTRACTED TEXT/, /PLAIN ATS READ/]) expect(out).toMatch(label);
  }, 120_000);
});

describe("Found along the way: title vs company when the title has no known title word", () => {
  it('"Senior QA, Northwind Games" → title Senior QA, company Northwind Games', () => {
    const roles = parseRoles(["Senior QA, Northwind Games Jun 2019 – Mar 2022", "• Redesigned test strategy"]);
    expect(roles[0]).toMatchObject({ title: "Senior QA", company: "Northwind Games" });
  });
});
