import { KNOCKOUT_VERDICT } from "./nlp/knockouts";
import type { AnalysisResult, CategoryScores, KeywordMatch } from "./types";

// Builds a single Markdown report meant to be pasted into Claude (or any assistant) to revise
// the resume. It leads with instructions, then the findings in order of impact, then the full
// job description and resume so the assistant has everything in one message.

const CATEGORY_LABEL: Record<keyof CategoryScores | "writingQuality", string> = {
  hardSkills: "Hard Skills & Tools",
  experienceAlignment: "Experience Alignment",
  sectionStructure: "Section Structure",
  formattingHealth: "Formatting & Parse Health",
  bulletImpact: "Bullet Impact",
  writingQuality: "Writing Quality",
};

const MATCH_LABEL: Record<KeywordMatch["matchType"], string> = {
  exact: "exact",
  alias: "via acronym/alias",
  "word-form": "word form (e.g. managed vs manage)",
  semantic: "reworded / near-spelling",
  related: "partial: only a related skill/tool found",
  none: "not found",
};

/** Escape characters that would break a Markdown table cell. */
const cell = (s: string | number | null | undefined) => String(s ?? "—").replace(/\|/g, "\\|").replace(/\n+/g, " ");

export interface ReportOptions {
  /**
   * Keep the uploaded layout exactly: the prompt asks only for a diff-style list of word swaps,
   * never a restructure (no single-column rewrite), and the word count must not increase.
   */
  keepLayout?: boolean;
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

function keepLayoutPrompt(r: AnalysisResult, resumeText: string): string {
  const target = r.mode === "match" ? `the job description below${r.jd.targetTitle ? ` (${r.jd.targetTitle})` : ""}` : "applicant tracking systems and recruiters in general";
  return [
    `You are an expert resume writer and ATS (applicant tracking system) specialist. Below is an automated ATS analysis of my resume against ${target}, followed by the full ${r.mode === "match" ? "job description and my " : ""}resume.`,
    ``,
    `KEEP-LAYOUT MODE. My resume's layout is final. Do NOT rewrite or restructure it: no single-column conversion, no renaming or reordering headings, no moving sections, no new lines, bullets or sections, no removing tables or text boxes.`,
    ``,
    `Instead, give me a diff-only list of word swaps I can apply by hand. Rules:`,
    `- Each swap replaces an exact phrase that appears in my resume with a new phrase of the same or fewer words.`,
    `- The total word count must not increase: it is ${wordCount(resumeText)} words now, and must be ${wordCount(resumeText)} or fewer after all swaps.`,
    `- Never append a clause or a result to a bullet. Never add a number I haven't given; a placeholder like [N] may only replace a vague word ("several" -> "[N]"), and never on a bullet that already has a number or on alignment/risk/governance bullets.`,
    `- Keep everything true. Do not add any skill, tool or keyword unless it already appears somewhere in my resume. Missing JD keywords go under "Questions for you", never into the swaps.`,
    `- Ignore findings that need a layout change (tables, text boxes, columns, headers/footers); list them under "Layout notes (not applied)".`,
    ``,
    `Reply with:`,
    `1. **Word swaps**: a table | # | Section / bullet | Find (exact text) | Replace with | Words (before → after) | Fixes finding |.`,
    `2. **Word count**: before, after, and the net change (must be ≤ 0).`,
    `3. **Layout notes (not applied)**: findings that only a layout change could fix.`,
    `4. **Questions for you**: skills you're unsure I have, real numbers for any [N].`,
  ].join("\n");
}

function prompt(r: AnalysisResult): string {
  const target = r.mode === "match" ? `the job description below${r.jd.targetTitle ? ` (${r.jd.targetTitle})` : ""}` : "applicant tracking systems and recruiters in general";
  return [
    `You are an expert resume writer and ATS (applicant tracking system) specialist. Below is an automated ATS analysis of my resume against ${target}, followed by the full ${r.mode === "match" ? "job description and my " : ""}resume.`,
    ``,
    `Please revise my resume to fix the issues in this report. Work in this order: knockout risks, then missing must-have keywords, then formatting and structure, then weak bullets and writing.`,
    ``,
    `Rules:`,
    `- Keep everything true. Only use experience, tools, employers, dates and results that already appear in my resume. Never invent numbers, skills or responsibilities.`,
    `- Add a missing keyword only where my existing experience plausibly involved it, at most one new keyword per bullet. If you're not sure I have a skill, ask me instead of adding it.`,
    `- Never invent numbers. Don't add a placeholder to a bullet that already has a number, or to alignment, coordination, risk or governance bullets (a metric is optional there). Elsewhere, if a result is missing, use a placeholder like [X%] and list it under "Questions for you".`,
    `- Use an ATS-safe format: a single column, standard headings (Professional Summary, Work Experience, Education, Skills, Certifications), contact details in the body (not a header), plain bullets, and Month YYYY dates.`,
    `- Write important acronyms both ways once, e.g. "Amazon Web Services (AWS)".`,
    `- Start bullets with strong past-tense action verbs (present tense for a current role), and keep them to one or two lines.`,
    ``,
    `Reply with:`,
    `1. **Revised resume**: complete, in plain text I can paste into a document.`,
    `2. **What changed and why**: a short list that maps each change to the report finding it fixes.`,
    `3. **Questions for you**: anything you need from me (real numbers for placeholders, whether I have a skill, how to answer knockout questions).`,
    r.knockouts && r.knockouts.status !== "clear"
      ? `4. **Knockout advice**: for each knockout item, whether resume wording can address it or I should answer it on the application form (don't claim eligibility I haven't stated).`
      : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export function buildClaudeReport(r: AnalysisResult, resumeText?: string, opts: ReportOptions = {}): string {
  const out: string[] = [];
  const add = (...lines: string[]) => out.push(...lines);
  const date = new Date(r.generatedAt).toISOString().slice(0, 10);

  add(`# ATS resume report: ${r.resume.fileName}`, ``);
  add(`> Generated ${date} by ATS Resume Analyzer (${r.engine.llm ? `Claude-assisted, ${r.engine.model}` : "built-in engine"}). Paste this whole file into Claude.`, ``);
  add(`## Instructions for the assistant`, ``, opts.keepLayout ? keepLayoutPrompt(r, resumeText ?? r.resume.text) : prompt(r), ``);

  // ---- Summary ----
  add(`## 1. Score summary`, ``);
  add(
    `- **${r.mode === "match" ? "Overall match score" : "General resume score (no job description)"}: ${r.overallScore}/100** (${r.band === "high" ? "high: likely to pass ATS keyword screens" : r.band === "moderate" ? "moderate" : "low"})`,
  );
  if (r.mode === "match") add(`- Target role: ${r.jd.targetTitle || "not detected"}${r.jd.seniority ? ` · ${r.jd.seniority}` : ""}${r.jd.experienceYears ? ` · ${r.jd.experienceYears}+ years` : ""}${r.jd.education ? ` · ${r.jd.education.label}${r.jd.education.required ? " required" : " preferred"}` : ""}`);
  const rolesCheck = r.diagnostics.find((d) => d.id === "section-roles");
  add(`- Candidate: ${r.resume.totalYears} years of dated experience · ${r.resume.roles.length} roles · ${r.resume.education[0]?.label ?? "no degree detected"}`);
  if (rolesCheck) add(`- Role-count check: ${rolesCheck.status === "pass" ? "OK" : "WARNING"}: ${rolesCheck.detail}`);
  add(`- ATS parse rate: ${r.atsView.parseRate}% (share of searchable fields a basic ATS can read)`);
  if (r.knockouts) {
    const verdict = KNOCKOUT_VERDICT[r.knockouts.status];
    add(`- Knockout screen: **${verdict}**${r.knockouts.parseConfidence ? ` (parse confidence: ${r.knockouts.parseConfidence})` : ""}`);
  }
  add(``, `| Category | Score | Weight in total |`, `|---|---|---|`);
  for (const k of Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]) {
    const score = k === "writingQuality" ? r.writing.score : r.categoryScores[k];
    add(`| ${CATEGORY_LABEL[k]} | ${score === null ? "n/a (needs a JD)" : `${score}/100`} | ${r.weights[k] ? `${r.weights[k]}%` : "advisory"} |`);
  }
  add(``);
  for (const k of Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]) {
    const why = r.explanations[k];
    if (!why?.length) continue;
    add(`**${CATEGORY_LABEL[k]}:** ${why.map((e) => `${e.label}: ${e.value}`).join("; ")}`, ``);
  }
  if (r.warnings.length) add(`**Warnings:**`, ...r.warnings.map((w) => `- ${w}`), ``);

  // ---- Knockouts ----
  if (r.knockouts && r.knockouts.checks.length) {
    add(`## 2. Knockout screen (yes/no filters that cause automatic rejection)`, ``, r.knockouts.summary, ``);
    add(`| Check | Status | Confidence | Job requires | Resume shows | Advice |`, `|---|---|---|---|---|---|`);
    const label = { pass: "Pass", risk: "Borderline", fail: "LIKELY KNOCKOUT", unknown: "Asked on form", unverifiable: "Unable to verify" } as const;
    const order = ["fail", "unverifiable", "risk", "unknown", "pass"];
    for (const c of [...r.knockouts.checks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)))
      add(`| ${cell(c.label)} | ${c.status === "fail" && c.confidence === "low" ? "Possible knockout" : label[c.status]} | ${c.confidence} | ${cell(c.requirement)} | ${cell(c.candidate)} | ${cell(c.advice)} |`);
    add(``);
  }

  // ---- Keywords ----
  if (r.mode === "match") {
    const d = r.keywords.details;
    const missMust = d.filter((m) => m.credit < 0.8 && m.priority === "must");
    const missNice = d.filter((m) => m.credit < 0.8 && m.priority === "nice");
    const matched = d.filter((m) => m.credit >= 0.8);
    add(`## 3. Keyword gaps`, ``);
    add(`Must-have keywords count 2x, nice-to-have 1x, and keywords the job description repeats count up to 1.75x more.`, ``);
    const table = (rows: KeywordMatch[]) => {
      add(`| Keyword | Type | JD mentions | Resume mentions | Status |`, `|---|---|---|---|---|`);
      for (const m of rows) add(`| ${cell(m.term)} | ${m.category.replace("_", " ")} | ${m.jdCount} | ${m.resumeCount} | ${MATCH_LABEL[m.matchType]}${m.matchedAs && m.matchType !== "exact" ? ` ("${cell(m.matchedAs)}")` : ""}${m.matchType === "related" && m.evidence ? `: ${cell(m.evidence)}` : ""} |`);
      add(``);
    };
    add(`### Missing must-have keywords (${missMust.length})`, ``);
    if (missMust.length) table(missMust);
    else add(`None.`, ``);
    add(`### Missing nice-to-have keywords (${missNice.length})`, ``);
    if (missNice.length) table(missNice);
    else add(`None.`, ``);
    add(`### Matched keywords (${matched.length})`, ``);
    if (matched.length) {
      add(`| Keyword | Match tier | Credit | Evidence from the resume |`, `|---|---|---|---|`);
      for (const m of matched) add(`| ${cell(m.term)} | ${MATCH_LABEL[m.matchType]} | ${Math.round(m.credit * 100)}% | ${cell(m.evidence)} |`);
      add(``);
    } else add(`None.`, ``);
    const under = d.filter((m) => m.credit >= 0.8 && m.jdCount >= 2 && m.resumeCount < m.jdCount);
    if (under.length) add(`### Emphasized in the JD but light on the resume`, ``, ...under.map((m) => `- ${m.term}: JD ${m.jdCount}×, resume ${m.resumeCount}×. Mention it where it was actually used.`), ``);
    const tips = d.filter((m) => m.acronymTip);
    if (tips.length) add(`### Acronym + full term`, ``, ...tips.map((m) => `- ${m.term}: ${m.acronymTip}`), ``);
    if (r.keywordPlacements.length) {
      add(
        `### Suggested keyword placements`,
        ``,
        r.engine.llm
          ? `Where each missing keyword could fit. Use one only if it's true of that work.`
          : `Rough, machine-generated placements: they show *where* a keyword could fit, not final wording. Use one only if it's true of that work, and rephrase naturally.`,
        ``,
      );
      for (const p of r.keywordPlacements)
        add(`- **${p.keyword}** (${p.priority === "must" ? "must-have" : "nice-to-have"}, ${p.section})${p.targetBullet ? `\n  - Current: ${p.targetBullet}\n  - Suggested: ${p.suggestion}` : `: ${p.suggestion}`}`);
      add(``);
    }
  }

  // ---- Formatting ----
  add(`## ${r.mode === "match" ? 4 : 2}. Formatting, structure & parsing issues`, ``);
  if (r.formattingIssues.length) {
    add(`Grouped by root cause: each row is one underlying problem, with its symptoms listed.`, ``, `| Severity | Issue | Fix |`, `|---|---|---|`);
    for (const i of r.formattingIssues) {
      const parts = i.items && i.items.length > 1 ? `${i.issue}: ${i.items.map((x) => x.issue).join("; ")}` : i.issue;
      add(`| ${i.severity.toUpperCase()} | ${cell(parts)} | ${cell(i.recommendation)} |`);
    }
  } else add(`No formatting or structure issues found.`);
  add(``);
  const failing = r.diagnostics.filter((x) => x.status !== "pass");
  const passing = r.diagnostics.filter((x) => x.status === "pass");
  if (failing.length) add(`Checks needing attention: ${failing.map((x) => `${x.label} (${x.status}: ${x.detail})`).join("; ")}`, ``);
  add(`Checks passed (${passing.length}): ${passing.map((x) => x.label).join(", ")}`, ``);

  // ---- ATS view ----
  add(`### What a basic ATS extracts (parse rate ${r.atsView.parseRate}%)`, ``);
  for (const f of r.atsView.fields) add(`- ${f.ok ? "✓" : "✗"} ${f.label}: ${f.value ?? "not found"}${f.note ? ` (${f.note})` : ""}`);
  if (r.atsView.notes.length) add(...r.atsView.notes.map((n) => `- Note: ${n}`));
  add(``);

  // ---- Writing ----
  add(`## ${r.mode === "match" ? 5 : 3}. Writing quality (${r.writing.score}/100, tone: ${r.writing.tone}, ${r.writing.wordCount} words)`, ``);
  if (r.writing.issues.length) {
    for (const i of r.writing.issues)
      add(`- [${i.kind}] ${i.message}${(i.count ?? 1) > 1 && i.kind !== "repetition" ? ` (×${i.count})` : ""}${i.suggestions.length ? `. Try: ${i.suggestions.map((s) => `"${s}"`).join(", ")}` : ""}${i.context ? `\n  - In: "${i.context}"` : ""}`);
  } else add(`No writing issues found.`);
  add(``);

  // ---- Bullets ----
  add(`## ${r.mode === "match" ? 6 : 4}. Bullet point audit (weakest first)`, ``);
  const audit = [...r.bulletAudit].sort((a, b) => a.score - b.score);
  if (audit.length) {
    add(`| Bullet | Role | Action verb | Metric | Note |`, `|---|---|---|---|---|`);
    for (const b of audit)
      add(`| ${cell(b.text)} | ${cell(b.role)} | ${b.strongVerb ? "yes" : "no"} | ${b.hasMetric ? "yes" : b.metricOptional ? "optional (alignment/risk work)" : "no"} | ${b.weakPhrase ? `weak opener "${b.weakPhrase}"` : ""} |`);
    add(``);
  } else add(`No bullet points were detected under Work Experience.`, ``);
  if (r.bulletPointImprovements.length) {
    add(`### Suggested rewrites (word substitutions only; any [N] needs a real number)`, ``);
    for (const b of r.bulletPointImprovements) {
      const swaps = (b.swaps ?? []).map((s) => `"${s.from || "(insert)"}" → "${s.to || "(remove)"}"`).join("; ");
      const delta = b.wordDelta ?? 0;
      add(`- Original: ${b.original}`, `  - Suggested: ${b.suggested}`, ...(swaps ? [`  - Swaps: ${swaps} (word count ${delta > 0 ? `+${delta}` : delta})`] : []), ...(b.reason ? [`  - Why: ${b.reason}`] : []));
    }
    add(``);
  }

  // ---- Source texts ----
  if (r.mode === "match" && r.jdText) add(`## Job description`, ``, "```text", r.jdText.trim(), "```", ``);
  add(`## ${resumeText && resumeText !== r.resume.text ? "Resume (current edited version)" : "Resume (as parsed from the file)"}`, ``, "```text", (resumeText ?? r.resume.text).trim(), "```", ``);
  return out.join("\n");
}

export function reportFileName(r: AnalysisResult): string {
  const base = r.resume.fileName.replace(/\.\w+$/, "").replace(/-tailored$/, "").replace(/[^\w.-]+/g, "-") || "resume";
  return `${base}-ats-report-for-claude.md`;
}
