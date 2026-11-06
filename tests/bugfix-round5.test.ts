// Fifth round: a Transformation - Associate Manager (CL8) JD. One describe block per item; every
// test asserts extracted facts (keywords, priorities, tiers, statuses, labels), never score values.
// fixtures/transformation-jd.txt mirrors the real JD's structure with a fictional employer.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { structureJDHeuristic } from "@/lib/nlp/jd";
import { analyze } from "@/lib/analyze";
import { parseText } from "@/lib/parsers";
import { parseResume } from "@/lib/nlp/resume";
import { resumeEducation } from "@/lib/nlp/education";
import { keywordTotals, relatedSiblingsOf } from "@/lib/nlp/matcher";
import { buildClaudeReport } from "@/lib/report";
import { contradictingChecks, summaryLeadPhrase } from "@/lib/scoring/engine";
import { ladderLevel } from "@/lib/nlp/levels";
import { CUSTOM_WORDS, analyzeWriting } from "@/lib/nlp/writing";
import { campusSignals } from "@/lib/nlp/campus";
import { selfCheck } from "@/lib/selfcheck";
import { parseResumeFile } from "@/lib/parsers";
import { buildDocx, p, tbl, tc, textBox, tr } from "./helpers/docx";

const JD = readFileSync("fixtures/transformation-jd.txt", "utf8");
// Fictional candidate (anonymised, own wording): MBA-equivalent in progress, campus template.
const RESUME = [
  "ANANYA RAO",
  "FT100200 Batch of 2026-27",
  "PROFILE SUMMARY",
  "Operations professional simplifying and automating business processes with Python/SQL process mining, business cases and stakeholder management",
  "KEY SKILLS",
  "• PROCESS SIMPLIFICATION",
  "• PROCESS AUTOMATION",
  "• GENAI & AGENTIC AI",
  "• TEAM AND RISK MANAGEMENT",
  "• SQL & PYTHON",
  "PROFESSIONAL EXPERIENCE",
  "Product Analyst, Brightpath May 2024 – Sep 2025",
  "• Rebuilt the lead intake process end to end, built an SQL funnel to locate drop-offs and lifted conversions by 30%",
  "• Replaced a manual weekly report with a self-serve dashboard, cutting preparation from 1 hour to 5 minutes",
  "QA Lead, Lumenly Mar 2022 – May 2024",
  "• Ran a DMAIC root-cause study on subscriber churn with interviews and cohort data, reducing churn by 12%",
  "• Coached a 4-member team and wrote triage SOPs that resolved 90% of tickets without engineering help",
  "Senior QA, Northwind Games Jun 2019 – Mar 2022",
  "• Reworked resource planning for global test teams on tight budgets, supporting 30% revenue growth",
  "ACADEMIC PROJECTS",
  "• Finance P2P Process Mining: Python/SQL analysis of a 1.6M-event SAP log found 25% payment blocks; DMAIC fixes modelled at ₹70 lakh/yr",
  "QUALIFICATIONS",
  "PGPM | Westbrook School of Management, Pune | 3.20/4 | 2027",
  "B. Tech. | Riverside Institute of Technology and Management | 75.00% | 2019",
].join("\n");
const terms = (jd: string) => structureJDHeuristic(jd).keywords;
const kw = (jd: string, term: string) => terms(jd).find((k) => k.term.toLowerCase() === term.toLowerCase());

describe("Item 1: desirable items are never knockouts", () => {
  it('"Lean Six Sigma Green Belt / Black Belt desirable" under Preference: is nice-to-have, not a knockout', async () => {
    const cert = kw(JD, "Six Sigma Certification");
    expect(cert?.priority).toBe("nice");
    expect(cert?.hardRequirement).toBe(false);
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    expect(r.knockouts!.checks.some((c) => /six sigma/i.test(c.label))).toBe(false);
  });

  it("strength comes from headings and modal words", () => {
    const head = (h: string, line: string) => kw(`${h}\n• ${line}`, "PMP");
    expect(head("Preferred:", "PMP certification")?.priority).toBe("nice");
    expect(head("Nice to have:", "PMP certification")?.priority).toBe("nice");
    expect(head("Good to have:", "PMP certification")?.priority).toBe("nice");
    expect(head("Bonus:", "PMP certification")?.priority).toBe("nice");
    for (const cue of ["desirable", "preferred", "a plus", "an advantage"]) expect(head("Key Attributes:", `PMP certification is ${cue}`)?.priority).toBe("nice");
    // Must-have but not stated as required: scored as must-have, never a knockout.
    expect(head("Key Attributes:", "PMP certification")?.hardRequirement).toBe(false);
    for (const cue of ["required", "mandatory", "a must", "the minimum"]) expect(head("Key Attributes:", `PMP certification is ${cue}`)?.hardRequirement).toBe(true);
    for (const h of ["Requirements:", "Qualifications:", "Education:"]) expect(head(h, "PMP certification")?.hardRequirement).toBe(true);
  });

  it("a required certification is still a knockout", async () => {
    const jd = `${JD}\nRequirements:\n• PMP certification is mandatory`;
    const r = await analyze(parseText(RESUME), jd, { useLLM: false });
    expect(r.knockouts!.checks.find((c) => c.label === "Certification: PMP")?.status).toBe("fail");
  });
});

describe("Item 2: the specific degree and its qualifier are kept", () => {
  it('"MBA from a premier institute (Tier 1 / Tier 2)" is shown as "MBA (Tier 1/Tier 2)"', () => {
    const e = structureJDHeuristic(JD).education!;
    expect(e).toMatchObject({ level: 4, degree: "MBA", qualifier: "Tier 1/Tier 2", label: "MBA (Tier 1/Tier 2)", required: true });
  });

  it("PGPM, PGDM, PGP and PGDBA are MBA-equivalent", () => {
    for (const d of ["PGPM", "PGDM", "PGP", "PGDBA", "MBA", "MBA (PGPM)"]) {
      const [top] = resumeEducation(parseResume(`EDUCATION\n${d} | Westbrook School of Management, Pune | 2024`));
      expect(top?.mbaEquivalent, d).toBe(true);
    }
    const [mtech] = resumeEducation(parseResume("EDUCATION\nM.Tech | Riverside Institute of Technology | 2020"));
    expect(mtech.mbaEquivalent).toBe(false);
  });

  it("the knockout row says MBA (Tier 1/Tier 2) and reads PGPM as MBA-equivalent", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const deg = r.knockouts!.checks.find((c) => c.id === "degree")!;
    expect(deg.requirement).toBe("MBA (Tier 1/Tier 2)");
    expect(deg.candidate).toMatch(/^PGPM \(MBA-equivalent\)/);
    expect(deg.advice).toMatch(/Tier 1\/Tier 2 institute/);
  });

  it("a non-MBA master's against an MBA requirement is flagged, not passed", async () => {
    const r = await analyze(parseText(RESUME.replace("PGPM | Westbrook School of Management, Pune | 3.20/4 | 2027", "M.Tech | Riverside Institute of Technology | 8.1 CGPA | 2021")), JD, { useLLM: false });
    const deg = r.knockouts!.checks.find((c) => c.id === "degree")!;
    expect(deg.status).toBe("risk");
    expect(deg.advice).toMatch(/not an MBA/);
  });
});

describe("Item 4: methods give related credit to their skill", () => {
  it('a resume with "DMAIC" and no "Six Sigma" matches Lean Six Sigma at the related tier, with evidence', async () => {
    expect(RESUME).not.toMatch(/six sigma/i);
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const m = r.keywords.details.find((d) => d.term === "Lean Six Sigma")!;
    expect(m.matchType).toBe("related");
    expect(m.evidence).toMatch(/\[DMAIC\]/);
  });

  it("each listed method or tool is a sibling of its skill", () => {
    const sib = (t: string) => relatedSiblingsOf([t]);
    for (const m of ["dmaic", "sipoc", "pareto", "5-why", "control chart", "ctq", "kaizen"]) expect(sib("Lean Six Sigma"), m).toContain(m);
    for (const m of ["pm4py", "celonis", "event log"]) expect(sib("Process Mining"), m).toContain(m);
    for (const m of ["uipath", "power automate"]) expect(sib("Robotic Process Automation"), m).toContain(m);
    // ITIL is not a Lean Six Sigma method.
    expect(sib("Lean Six Sigma")).not.toContain("itil");
  });
});

describe("Item 5: no keyword the JD never asked for", () => {
  it('a JD with "GenAI" but no "LLM" never reports Large Language Models', async () => {
    expect(JD).toMatch(/GenAI/);
    expect(JD).not.toMatch(/\bLLMs?\b|large language/i);
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    expect(r.keywords.details.map((d) => d.term)).not.toContain("Large Language Models");
    const g = r.keywords.details.find((d) => d.term === "Generative AI")!;
    expect(g.matchType).toBe("alias");
    expect(g.evidence).toMatch(/\[GENAI\]/);
    expect(g.jdEvidence).toMatch(/\[GenAI\]/);
  });

  it("every reported keyword has a JD line it came from, never the About blurb", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    for (const d of r.keywords.details) {
      expect(d.jdEvidence, d.term).toMatch(/\[.+\]/);
      expect(d.jdEvidence, d.term).not.toMatch(/Northbridge is a global|equal opportunities|COVID/);
    }
    // "consulting" is in the About text too, but it was extracted from the Preference line, and
    // the About mention doesn't count as the employer asking twice.
    const consulting = r.keywords.details.find((d) => d.term === "Consulting")!;
    expect(consulting.jdEvidence).toMatch(/relevant experience in \[consulting\]/);
    expect(consulting.jdCount).toBe(1);
  });
});

describe("Item 6: business, consulting and operations keywords", () => {
  it("extracts the full list from the CL8-style JD", () => {
    const list = terms(JD).map((k) => k.term.toLowerCase());
    for (const t of ["process simplification", "standardization", "automation", "business case", "governance", "change management", "python", "sql", "lean six sigma", "finance", "supply chain", "stakeholder management"])
      expect(list, t).toContain(t);
    for (const t of ["business transformation", "risk management", "project management", "team management", "robotic process automation", "generative ai", "hr", "insurance", "financial services", "consulting", "operations", "problem solving"])
      expect(list, t).toContain(t);
  });

  it("domains are their own type, and nice-to-have unless stated as required", () => {
    for (const t of ["Finance", "HR", "Supply Chain", "Insurance", "Financial Services"]) expect(kw(JD, t), t).toMatchObject({ category: "domain", priority: "nice" });
    expect(kw("Requirements:\n• Must have Insurance domain experience", "Insurance")?.priority).toBe("must");
  });

  it("Learning Opportunities count at nice-to-have weight, never as must-haves", () => {
    const jd = "Key Attributes:\n• Strong SQL skills\n\nLearning Opportunities:\n• Strengthen skills in RPA and AI/GenAI toolchains";
    expect(kw(jd, "Robotic Process Automation")?.priority).toBe("nice");
    expect(kw(jd, "Generative AI")?.priority).toBe("nice");
    expect(kw(jd, "SQL")?.priority).toBe("must");
  });

  it('"Robotic Process Automation" is one keyword, not also "Automation"', () => {
    expect(terms("Key Attributes:\n• Robotic Process Automation delivery").map((k) => k.term)).toEqual(["Robotic Process Automation"]);
  });

  it("the resume gets credit where it uses these words", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const tier = (t: string) => r.keywords.details.find((d) => d.term === t)?.matchType;
    expect(tier("Process Simplification")).toBe("exact");
    expect(tier("Automation")).not.toBe("none");
    expect(tier("Business Case")).toBe("exact");
    expect(tier("Team Management")).not.toBe("none");
    expect(tier("Finance")).toBe("exact");
  });
});

describe("Item 7: boilerplate never yields keywords", () => {
  it("COVID-19, Business Ethics Line and equal opportunities never become keywords, with or without a Disclaimer heading", () => {
    const noHeading = JD.replace("Disclaimer(s):\n", "");
    for (const jd of [JD, noHeading]) {
      const words = terms(jd).flatMap((k) => [k.term, ...k.aliases]).join(" | ");
      expect(words).not.toMatch(/covid|ethics|equal opportunit|vaccin|placement/i);
    }
    // A skill named only inside a notice is not a requirement.
    expect(kw("Key Attributes:\n• Python\n• Northbridge is an equal opportunities employer; Salesforce staff never collect money", "Salesforce")).toBeUndefined();
  });
});

describe("Item 8: summary counts match the tables", () => {
  it("matched + missing = total in every bucket, and the summary shows the same numbers as the report tables", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const t = keywordTotals(r.keywords.details);
    for (const b of [t.must, t.nice, t.soft, t.all]) expect(b.matched + b.missing).toBe(b.total);
    expect(t.must.total + t.nice.total + t.soft.total).toBe(t.all.total);
    const why = Object.fromEntries(r.explanations.hardSkills.map((e) => [e.label, e.value]));
    expect(why["Must-have matched (2x weight)"]).toBe(`${t.must.matched} / ${t.must.total}`);
    expect(why["Nice-to-have matched (1x weight)"]).toBe(`${t.nice.matched} / ${t.nice.total}`);
    expect(why["Soft skills matched (listed, not scored)"]).toBe(`${t.soft.matched} / ${t.soft.total}`);
    const md = buildClaudeReport(r);
    const count = (h: string) => Number(md.match(new RegExp(`### ${h} \\((\\d+)`))?.[1]);
    expect(count("Missing must-have keywords")).toBe(t.must.missing);
    expect(count("Missing nice-to-have keywords")).toBe(t.nice.missing);
    expect(count("Matched keywords")).toBe(t.must.matched + t.nice.matched);
    expect(md).toContain(`### Soft skills (${t.soft.matched} of ${t.soft.total} found; listed, not scored)`);
  });
});

describe("Item 9: layout checks never contradict each other", () => {
  it("Single-column layout warns (not passes) when tables and text boxes failed", async () => {
    const body = [p("ANANYA RAO"), tbl(tr(tc(p("PROFILE SUMMARY")), tc(p("Operations professional automating business processes with Python and SQL across global teams")))), textBox(p("KEY SKILLS"), p("• SQL")), ...RESUME.split("\n").slice(4).map((l) => p(l))].join("");
    // Not a campus JD: there, failures become warnings (item 14).
    const r = await analyze(await parseResumeFile(await buildDocx({ body }), "r.docx"), JD.replace(/^.*campus recruitment.*$/m, ""), { useLLM: false });
    const st = (id: string) => r.diagnostics.find((d) => d.id === id)?.status;
    expect(st("tables")).toBe("fail");
    expect(st("text-boxes")).toBe("fail");
    expect(st("columns")).toBe("warn");
    expect(r.diagnostics.find((d) => d.id === "columns")!.detail).toMatch(/side by side/);
    expect(contradictingChecks(r.diagnostics)).toEqual([]);
  });

  it("a plain single-column resume still passes", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    expect(r.diagnostics.find((d) => d.id === "columns")?.status).toBe("pass");
  });
});

describe("Item 10: consulting ladder levels", () => {
  it('"Level: CL8 - Associate Manager" is an Associate Manager / first-line manager role, not Lead / Staff', async () => {
    expect(structureJDHeuristic(JD).seniority).toBe("Associate Manager / first-line manager");
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const sen = r.explanations.experienceAlignment.find((e) => e.label.startsWith("Seniority level"))!.value;
    expect(sen).toMatch(/vs Associate Manager \/ first-line manager role/);
    expect(sen).not.toMatch(/Lead \/ Staff/);
  });

  it("orders the ladder Analyst < Senior Analyst < Consultant < Associate Manager < Manager, and reads CL numbers", () => {
    const lv = (t: string) => ladderLevel(t)?.level;
    expect([lv("Analyst"), lv("Senior Analyst"), lv("Consultant"), lv("Associate Manager"), lv("Manager"), lv("Senior Manager")]).toEqual([1, 2, 3, 4, 5, 5]);
    expect([lv("CL11"), lv("CL10"), lv("CL9"), lv("CL8"), lv("CL7"), lv("CL6")]).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it("the explicit Level field wins over the title", () => {
    expect(structureJDHeuristic("Role: Transformation Lead\nLevel: CL9 - Consultant\nKey Attributes:\n• SQL and Python for automation of reporting").seniority).toBe("Consultant");
  });
});

describe("Item 11: title match without a headline", () => {
  it("compares the latest title and the summary's opening phrase, says which was used, and suggests a headline", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const title = r.explanations.experienceAlignment.find((e) => e.label.startsWith("Title match"))!.value;
    expect(title).not.toMatch(/\(summary headline\)/);
    expect(title).toMatch(/vs (most recent title "Product Analyst"|summary's opening phrase "Operations professional" \(no headline found\))/);
    expect(summaryLeadPhrase("Transformation professional standardising and automating business processes")).toBe("Transformation professional");
    expect(r.formattingIssues.flatMap((i) => i.items ?? [i]).some((i) => i.id === "missing-headline")).toBe(true);
  });

  it("a real headline under the name is used, and no suggestion is made", async () => {
    const withHeadline = RESUME.replace("ANANYA RAO\n", "ANANYA RAO\nTransformation Associate Manager | Lean Six Sigma\n");
    const r = await analyze(parseText(withHeadline), JD, { useLLM: false });
    expect(r.explanations.experienceAlignment.find((e) => e.label.startsWith("Title match"))!.value).toMatch(/vs headline "Transformation Associate Manager \| Lean Six Sigma"/);
    expect(r.formattingIssues.flatMap((i) => i.items ?? [i]).some((i) => i.id === "missing-headline")).toBe(false);
  });
});

describe("Item 12: no false spelling flags on business and Indian English terms", () => {
  const flagged = async (text: string) =>
    (await analyzeWriting(parseResume(`PROFESSIONAL EXPERIENCE\nAnalyst, Brightpath Jan 2020 – Present\n• ${text}`))).issues.filter((i) => i.kind === "spelling").map((i) => i.text.toLowerCase());

  it('"₹73 lakh" and "competitor benchmarking" are not flagged', async () => {
    expect(await flagged("Modelled fixes at ₹73 lakh per year after competitor benchmarking")).toEqual([]);
  });

  it("business vocabulary, crore/lakh and units next to numbers pass; real typos are still caught", async () => {
    expect(await flagged("Led upskilling, onboarding and rollout for stakeholders; saved 2 crore and 3 lakhs")).toEqual([]);
    expect(await flagged("Managed the stakehlder roadmap")).toEqual(["stakehlder"]);
  });

  it("words in the custom dictionary are never flagged", async () => {
    expect(CUSTOM_WORDS).toContain("guardrailed");
    expect(await flagged("Shipped a guardrailed exception agent")).toEqual([]);
  });
});

describe("Item 13 (keep): lowercase-first bullets are still flagged", () => {
  it('"esports" as a bullet is a grammar finding', async () => {
    const w = await analyzeWriting(parseResume("EXTRA-CURRICULARS\n• Community Service\n• esports\nPROFESSIONAL EXPERIENCE\nAnalyst, Brightpath Jan 2020 – Present\n• Built dashboards"));
    expect(w.issues.some((i) => i.kind === "grammar" && /lowercase/.test(i.message) && i.text === "esports")).toBe(true);
  });
});

describe("Item 14: campus placement templates", () => {
  it("detects a roll number + batch, or campus language in the JD", () => {
    expect(campusSignals(RESUME, "")).toEqual(["a roll number at the top of the resume", '"Batch of" on the resume']);
    expect(campusSignals("ANANYA RAO\nPROFILE SUMMARY", JD)).toEqual(["campus-recruitment language in the job description"]);
    expect(campusSignals("ANANYA RAO\nPROFILE SUMMARY", "Key Attributes:\n• SQL")).toEqual([]);
    // A roll-number-like code alone is not enough.
    expect(campusSignals("ANANYA RAO\nAB123456 project code", "")).toEqual([]);
  });

  it("shows the notice and turns formatting/contact failures into warnings, keeping the checks", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    expect(r.campus?.signals.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/^This looks like a campus placement template\. Formatting and contact-detail checks apply only if you apply directly/);
    for (const id of ["contact-email", "contact-phone", "contact-header"]) {
      const c = r.diagnostics.find((d) => d.id === id)!;
      expect(c.status, id).toBe("warn");
      expect(c.detail).toMatch(/campus template/);
    }
    expect(r.formattingIssues.some((i) => i.severity === "high")).toBe(false);
  });

  it("without campus signals the same checks still fail", async () => {
    const plain = RESUME.replace("FT100200 Batch of 2026-27\n", "");
    const jd = JD.replace(/^.*campus recruitment.*$/m, "");
    const r = await analyze(parseText(plain), jd, { useLLM: false });
    expect(r.campus).toBeNull();
    expect(r.diagnostics.find((d) => d.id === "contact-email")?.status).toBe("fail");
  });
});

describe("Item 15: in-progress degree on a campus JD", () => {
  it("advises that final-year candidates are usually eligible, instead of a borderline knockout", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const deg = r.knockouts!.checks.find((c) => c.id === "degree")!;
    expect(deg.status).toBe("pass");
    expect(deg.candidate).toMatch(/in progress/);
    expect(deg.advice).toMatch(/final-year candidates are usually eligible/);
    expect(deg.advice).toMatch(/placement office/);
  });

  it("off campus, the same degree stays borderline", async () => {
    const r = await analyze(parseText(RESUME.replace("FT100200 Batch of 2026-27\n", "")), JD.replace(/^.*campus recruitment.*$/m, ""), { useLLM: false });
    expect(r.knockouts!.checks.find((c) => c.id === "degree")?.status).toBe("risk");
  });
});

describe("Item 16: academic vs professional evidence", () => {
  it('keyword evidence from "Academic Projects" is tagged as a project (weighted below work, not ignored)', async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    // "Finance" appears only in the academic project line.
    const pm = r.keywords.details.find((d) => d.term === "Finance")!;
    expect(pm.matchType).toBe("exact");
    expect(pm.locations).toContain("project");
    expect(pm.locations).not.toContain("recent role");
  });

  it('flags "SAP log" in a project without a data-source label, and not once a source is named', async () => {
    const ids = async (text: string) => {
      const r = await analyze(parseText(text), JD, { useLLM: false });
      return r.formattingIssues.flatMap((i) => i.items ?? [i]).filter((i) => i.id === "project-data-source");
    };
    const flagged = await ids(RESUME);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].issue).toMatch(/"SAP"/);
    expect(await ids(RESUME.replace("a 1.6M-event SAP log", "the public BPI Challenge 2019 SAP log"))).toHaveLength(0);
  });
});

describe("Item 17: tier and evidence for every keyword", () => {
  it("every row of every keyword table in the report has a tier, resume evidence (or 'none') and its JD line", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const md = buildClaudeReport(r);
    const rows = md.split("\n").filter((l) => /^\| /.test(l) && r.keywords.details.some((d) => l.startsWith(`| ${d.term} |`)));
    expect(rows).toHaveLength(r.keywords.details.length);
    for (const row of rows) {
      const cells = row.split(/(?<!\\)\|/).map((c) => c.trim());
      expect(cells[3], row).toMatch(/^(exact|via acronym\/alias|word form|reworded|partial|not found)/);
      expect(cells[6], row).toMatch(/\[.+\]|^none$/);
      expect(cells[7], row).toMatch(/\[.+\]/);
    }
    // Not found and related rows say so explicitly.
    const lss = rows.find((l) => l.startsWith("| Lean Six Sigma |"))!;
    expect(lss).toMatch(/partial: only a related skill\/tool found \("DMAIC"\)/);
  });
});

describe("Item 18: hard knockouts vs preferences you don't meet", () => {
  it("the desirable belt is a preference, not a knockout, and doesn't change the verdict", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const k = r.knockouts!;
    expect(k.checks.every((c) => c.kind !== "preference")).toBe(true);
    const belt = k.preferences!.find((c) => c.label === "Certification: Six Sigma Certification")!;
    expect(belt.requirement).toMatch(/Lean Six Sigma Green Belt \/ Black Belt desirable/);
    expect(belt.candidate).toBe("Not found");
    expect(k.status).not.toBe("likely-reject");
    expect(k.summary).toMatch(/1 preference you don't meet is listed separately \(never an automatic rejection\)\.$/);
    const md = buildClaudeReport(r);
    const hard = md.slice(md.indexOf("### Hard knockouts"), md.indexOf("### Preferences you don't meet"));
    const pref = md.slice(md.indexOf("### Preferences you don't meet"), md.indexOf("## 3."));
    expect(hard).not.toMatch(/Six Sigma/);
    expect(pref).toMatch(/\| Certification: Six Sigma Certification \|/);
  });

  it("preferred years and languages below the bar are preferences; met preferences are not listed", async () => {
    const jd = `${JD}\nPreference:\n• Spanish fluency preferred\n• Exposure to Insurance preferred`;
    const r = await analyze(parseText(RESUME), jd, { useLLM: false });
    expect(r.knockouts!.preferences!.some((c) => c.label === "Language: Spanish")).toBe(true);
    expect(r.knockouts!.checks.some((c) => c.label === "Language: Spanish")).toBe(false);
  });
});

describe("Item 19: self-check line at the end of every report", () => {
  it("reports totals reconcile, no keyword outside the JD and no contradicting checks", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const sc = selfCheck(r);
    expect(sc.items.map((i) => [i.label, i.ok])).toEqual([
      ["totals reconcile", true],
      ["no keyword outside the JD", true],
      ["no contradicting checks", true],
    ]);
    const md = buildClaudeReport(r).trimEnd();
    expect(md.split("\n").at(-1)).toBe(sc.line);
    expect(sc.line).toMatch(/^Self-check: ✓ totals reconcile/);
  });

  it("catches a broken result", async () => {
    const r = await analyze(parseText(RESUME), JD, { useLLM: false });
    const broken = {
      ...r,
      keywords: { ...r.keywords, details: [...r.keywords.details, { ...r.keywords.details[0], term: "Large Language Models", jdEvidence: null }] },
      diagnostics: r.diagnostics.map((d) => (d.id === "columns" ? { ...d, status: "pass" as const } : d.id === "tables" ? { ...d, status: "fail" as const } : d)),
    };
    const sc = selfCheck(broken);
    expect(sc.ok).toBe(false);
    expect(sc.items.find((i) => i.label === "no keyword outside the JD")?.detail).toMatch(/Large Language Models/);
    expect(sc.items.find((i) => i.label === "no contradicting checks")?.ok).toBe(false);
    expect(sc.items.find((i) => i.label === "totals reconcile")?.ok).toBe(false);
  });
});

describe("Item 3: multi-word skills are one keyword", () => {
  it('"Lean Six Sigma" twice is one keyword, not LEAN + Six Sigma + a certification', () => {
    const jd = `Key Attributes:\n• Solid grounding in Lean Six Sigma and structured problem-solving\n• Apply Lean Six Sigma tools to reporting workflows and operations`;
    const list = terms(jd).map((k) => k.term);
    expect(list.filter((t) => /lean|six sigma/i.test(t))).toEqual(["Lean Six Sigma"]);
  });

  it("the belt is one separate certification keyword, only where the JD names a belt", () => {
    const k = terms(JD);
    expect(k.filter((x) => /lean|six sigma/i.test(x.term)).map((x) => x.term).sort()).toEqual(["Lean Six Sigma", "Six Sigma Certification"]);
    expect(k.find((x) => x.term === "Six Sigma Certification")?.category).toBe("certification");
  });
});
