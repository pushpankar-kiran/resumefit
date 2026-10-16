import type {
  BulletAudit,
  CategoryScores,
  DiagnosticCheck,
  FormattingIssue,
  KeywordMatch,
  LayoutSignals,
  ParsedResume,
  ScoreExplanation,
  SectionKey,
  StructuredJD, ContactPresence } from "../types";
import { PLACES_SEARCHED } from "../nlp/contact";
import { hasMetric, metricOptional, startsWithStrongVerb, weakPhraseOf } from "../nlp/verbs";
import { stem } from "../nlp/text";
import { findPhone, nameProblem } from "../nlp/resume";
import { resumeEducation, scoreEducation } from "../nlp/education";
import type { CheckResult } from "../nlp/checks";
import { groupFindings, type Deduction } from "./findings";
import { statedExperienceYears } from "../nlp/knockouts";

/**
 * Dated roles vs the experience the resume states ("Experience: 75 months"). When they
 * disagree by more than 6 months, some roles weren't parsed: seniority then uses the stated
 * total so a parsing gap never downgrades the candidate.
 */
export function experienceCoverage(resume: ParsedResume): { roles: number; parsed: number; stated: number | null; missingRoles: boolean; years: number } {
  const stated = statedExperienceYears(resume.text);
  const parsed = resume.totalYears;
  // Only a shortfall means roles were missed. More dated years than stated ("7+ years" in a
  // summary written a while ago) is the candidate understating, not a parsing gap.
  const missingRoles = stated !== null && stated - parsed > 0.5;
  return { roles: resume.roles.filter((r) => r.dates).length, parsed, stated, missingRoles, years: missingRoles && stated! > parsed ? stated! : parsed };
}

// Category weights (sum to 100). Each category is scored 0-100, then weighted.
export const WEIGHTS: Record<keyof CategoryScores, number> = {
  hardSkills: 35,
  experienceAlignment: 25,
  sectionStructure: 15,
  formattingHealth: 15,
  bulletImpact: 10,
};

const PRIORITY_WEIGHT = { must: 2, nice: 1 } as const;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (n: number) => `${Math.round(n)}%`;

// ---------- 1. Hard skills & tools (35) ----------

export function scoreHardSkills(matches: KeywordMatch[]): { score: number; why: ScoreExplanation[] } {
  const hard = matches.filter((m) => m.category !== "soft_skill");
  if (!hard.length) return { score: 50, why: [{ label: "No hard skills detected in JD", value: "neutral 50" }] };
  let got = 0;
  let max = 0;
  for (const m of hard) {
    // Priority (must 2x / nice 1x) times how often the JD repeats the keyword (1x-1.75x).
    const w = PRIORITY_WEIGHT[m.priority] * (m.frequencyWeight ?? 1);
    max += w;
    got += w * m.credit;
  }
  const must = hard.filter((m) => m.priority === "must");
  const nice = hard.filter((m) => m.priority === "nice");
  const repeated = hard.filter((m) => (m.jdCount ?? 1) >= 2);
  const score = clamp((got / max) * 100);
  return {
    score,
    why: [
      { label: "Must-have matched (2x weight)", value: `${must.filter((m) => m.credit >= 0.8).length} / ${must.length}` },
      { label: "Nice-to-have matched (1x weight)", value: `${nice.filter((m) => m.credit >= 0.8).length} / ${nice.length}` },
      { label: "Repeated in JD (up to 1.75x weight)", value: `${repeated.filter((m) => m.credit >= 0.8).length} / ${repeated.length} matched` },
      { label: "Exact / alias / word-form / semantic / related", value: ["exact", "alias", "word-form", "semantic", "related"].map((t) => hard.filter((m) => m.matchType === t).length).join(" / ") },
      { label: "Weighted coverage", value: `${got.toFixed(1)} / ${max.toFixed(1)} pts` },
    ],
  };
}

// ---------- Seniority ----------

const LEVELS: [RegExp, number, string][] = [
  [/\b(intern|internship|trainee|apprentice)\b/i, 0, "Intern"],
  [/\b(junior|jr\.?|entry[- ]level|graduate|new grad|associate|assistant|i)\b/i, 1, "Junior"],
  [/\b(mid[- ]level|ii|intermediate)\b/i, 2, "Mid-level"],
  [/\b(senior|sr\.?|iii)\b/i, 3, "Senior"],
  [/\b(lead|staff|iv|manager)\b/i, 4, "Lead / Staff"],
  [/\b(principal|distinguished|head of|senior manager)\b/i, 5, "Principal"],
  [/\b(director|vp|vice president|chief|c[tefo]o|head)\b/i, 6, "Director+"],
];
export const LEVEL_NAMES = ["Intern", "Junior", "Mid-level", "Senior", "Lead / Staff", "Principal", "Director+"];

/** Highest-matching seniority level named in a title, or null if the title has none. */
export function levelOfTitle(title: string): number | null {
  // "Product Manager", "Account Manager"... are role names, not a management level.
  const roleManager = /\b(product|project|program|account|marketing|community|content|office|campaign|social media|case)\s+manager\b/i;
  const t = title.replace(roleManager, " ");
  let best: number | null = null;
  for (const [re, lvl] of LEVELS) if (re.test(t)) best = best === null ? lvl : Math.max(best, lvl);
  if (best === null && roleManager.test(title)) best = 2;
  return best;
}

export function levelFromYears(y: number): number {
  return y < 1 ? 0 : y < 2.5 ? 1 : y < 5 ? 2 : y < 9 ? 3 : y < 13 ? 4 : 5;
}

export function scoreSeniority(jd: StructuredJD, resume: ParsedResume): { score: number | null; detail: string; required: number | null; candidate: number } {
  const required = levelOfTitle(jd.targetTitle) ?? (jd.seniority ? levelOfTitle(jd.seniority) : null) ?? (jd.experienceYears ? levelFromYears(jd.experienceYears) : null);
  const fromTitle = levelOfTitle(resume.roles[0]?.title ?? "");
  // Never downgrade from the stated total when some roles couldn't be parsed.
  const fromYears = levelFromYears(experienceCoverage(resume).years);
  // Title wins when present, but years can lift a modest title by one level.
  const candidate = fromTitle === null ? fromYears : Math.max(fromTitle, Math.min(fromYears, fromTitle + 1));
  if (required === null) return { score: null, detail: "JD states no seniority level", required, candidate };
  const diff = candidate - required;
  const score = diff >= 0 ? (diff >= 3 ? 80 : 100) : diff === -1 ? 60 : 25;
  const detail = `You read as ${LEVEL_NAMES[candidate]} vs ${LEVEL_NAMES[required]} role${diff >= 3 ? " (may look over-qualified)" : ""}`;
  return { score, detail, required, candidate };
}

// ---------- 2. Experience & title alignment (25) ----------

const SENIORITY = ["intern", "junior", "jr", "associate", "senior", "sr", "lead", "staff", "principal", "head", "director", "vp", "chief", "manager", "mid", "ii", "iii", "iv", "i"];
const TITLE_SYNONYMS: Record<string, string> = {
  developer: "engineer", dev: "engineer", programmer: "engineer", swe: "software engineer", sde: "software engineer",
  eng: "engineer", mgr: "manager", pm: "product manager", "product owner": "product manager", fe: "frontend",
  "front-end": "frontend", "front end": "frontend", "back-end": "backend", "back end": "backend", "full-stack": "fullstack",
  "full stack": "fullstack", ml: "machine learning", "data analyst": "analyst", "business analyst": "analyst",
};

export function normalizeTitle(t: string): { core: string[]; level: string | null } {
  let s = ` ${t.toLowerCase().replace(/[^a-z0-9+#/ -]/g, " ")} `;
  for (const [k, v] of Object.entries(TITLE_SYNONYMS)) s = s.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  const words = s.split(/[\s/]+/).filter(Boolean);
  const level = words.find((w) => SENIORITY.includes(w)) ?? null;
  const core = words.filter((w) => !SENIORITY.includes(w) && !["of", "and", "the", "&", "-"].includes(w)).map(stem);
  return { core, level };
}

export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = normalizeTitle(a);
  const B = normalizeTitle(b);
  if (!A.core.length || !B.core.length) return 0;
  const sa = new Set(A.core);
  const sb = new Set(B.core);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const dice = (2 * inter) / (sa.size + sb.size);
  // Role noun (last core word: engineer, manager, analyst...) carries most of the meaning.
  const nounMatch = A.core[A.core.length - 1] === B.core[B.core.length - 1] ? 0.25 : 0;
  return Math.min(1, dice * 0.75 + nounMatch + (A.level && B.level && A.level === B.level ? 0.05 : 0));
}

export function scoreExperience(
  jd: StructuredJD,
  resume: ParsedResume,
  matches: KeywordMatch[],
): { score: number; why: ScoreExplanation[]; titleSim: number; yearsScore: number } {
  const roleWeights = [1, 0.85, 0.6, 0.6, 0.5];
  let titleSim = 0;
  let bestTitle = "";
  resume.roles.forEach((r, i) => {
    const s = titleSimilarity(jd.targetTitle, r.title) * (roleWeights[i] ?? 0.5);
    if (s > titleSim) {
      titleSim = s;
      bestTitle = r.title;
    }
  });
  // A summary headline that names the target title also counts (e.g. "Senior Product Manager with 8 years...").
  const headline = titleSimilarity(jd.targetTitle, resume.summary.split(/[.,|]/)[0] ?? "") * 0.9;
  if (headline > titleSim) {
    titleSim = headline;
    bestTitle = "(summary headline)";
  }
  const titleScore = jd.targetTitle ? titleSim * 100 : 70;

  const req = jd.experienceYears;
  const have = resume.totalYears;
  // Years are what an ATS counts: dated roles. A gap against the stated total is reported.
  const yearsScore = req ? Math.min(100, (have / req) * 100) : have > 0 ? 100 : 60;
  const cov = experienceCoverage(resume);
  const gapNote = cov.missingRoles ? ` (could not parse all roles: resume states ${cov.stated} yrs)` : "";

  // Positional recency: keywords evidenced in the summary or two most recent roles get 1.5x,
  // older roles 1.0x, and a bare listing in the Skills section only 0.75x.
  const hard = matches.filter((m) => m.category !== "soft_skill");
  let got = 0;
  let max = 0;
  for (const m of hard) {
    const w = PRIORITY_WEIGHT[m.priority];
    max += w * 1.5;
    if (!m.credit) continue;
    const factor = m.recencyBoosted ? 1.5 : m.locations.includes("older role") || m.locations.includes("other") ? 1.0 : 0.75;
    got += w * m.credit * factor;
  }
  const recencyScore = max ? (got / max) * 100 : 60;

  const sen = scoreSeniority(jd, resume);
  const edu = scoreEducation(jd.education, resumeEducation(resume));

  // Components the JD doesn't specify (seniority, education) drop out and the rest re-weight.
  const parts: { label: string; w: number; s: number | null; value: string }[] = [
    { label: "Title match", w: 30, s: titleScore, value: jd.targetTitle ? `${pct(titleScore)} vs "${bestTitle || "—"}"` : "JD title not found (neutral)" },
    { label: "Years of experience", w: 25, s: yearsScore, value: (req ? `${have} yrs vs ${req}+ required → ${pct(yearsScore)}` : `${have} yrs (JD states none)`) + gapNote },
    { label: "Seniority level", w: 15, s: sen.score, value: sen.score === null ? sen.detail : `${sen.detail} → ${pct(sen.score)}` },
    { label: "Education / degree", w: 15, s: edu.score, value: edu.score === null ? edu.detail : `${edu.detail} → ${pct(edu.score)}` },
    { label: "Recency-weighted keyword evidence", w: 15, s: recencyScore, value: pct(recencyScore) },
  ];
  const live = parts.filter((p) => p.s !== null);
  const wsum = live.reduce((a, p) => a + p.w, 0);
  const score = clamp(live.reduce((a, p) => a + (p.s as number) * p.w, 0) / wsum);
  return {
    score,
    titleSim,
    yearsScore,
    why: parts.map((p) => ({ label: `${p.label} (${p.s === null ? "n/a" : Math.round((p.w / wsum) * 100) + "%"})`, value: p.value })),
  };
}

// ---------- 3. Section structure (15) ----------

// Contact details aren't a section: they're checked (once) under Formatting > contact details.
const CORE: { key: SectionKey; label: string }[] = [
  { key: "summary", label: "Professional Summary" },
  { key: "experience", label: "Work Experience" },
  { key: "education", label: "Education" },
  { key: "skills", label: "Skills" },
];

export function scoreStructure(resume: ParsedResume): { score: number; why: ScoreExplanation[]; checks: DiagnosticCheck[]; issues: FormattingIssue[] } {
  const why: ScoreExplanation[] = [];
  const checks: DiagnosticCheck[] = [];
  const issues: FormattingIssue[] = [];
  let pts = 0;
  for (const { key, label } of CORE) {
    let present: boolean;
    let standard: boolean;
    let heading = "";
    if (key === "summary") {
      const sec = resume.sections.find((s) => s.key === key);
      present = !!sec || !!resume.summary;
      standard = sec ? sec.standard : false;
      heading = sec?.heading ?? (resume.summary ? "untitled paragraph" : "");
    } else {
      const sec = resume.sections.find((s) => s.key === key);
      present = !!sec;
      standard = !!sec?.standard;
      heading = sec?.heading ?? "";
    }
    const p = present ? (standard ? 25 : 12.5) : 0;
    pts += p;
    why.push({ label, value: present ? (standard ? `"${heading}" ✓` : `"${heading}" — non-standard (half credit)`) : "missing" });
    checks.push({
      id: `section-${key}`,
      label: `${label} section`,
      status: !present ? "fail" : standard ? "pass" : "warn",
      detail: !present ? "Not detected." : standard ? `Found as "${heading}".` : `Found as "${heading}", which many ATS parsers won't map.`,
    });
    if (!present) {
      issues.push({
        id: `missing-${key}`,
        severity: key === "experience" ? "high" : "medium",
        issue: `${label} section not detected`,
        recommendation:
          key === "summary"
            ? 'Add a 2-3 line "Professional Summary" that names the target title and your top matching skills.'
            : `Add a clearly labeled "${label}" section.`,
      });
    } else if (!standard) {
      issues.push({
        id: `nonstandard-${key}`,
        severity: "medium",
        issue: `Non-standard heading "${heading}" used for ${label}`,
        recommendation: `Rename it to "${label}" so the ATS files the content correctly.`,
      });
    }
  }
  const unknown = resume.sections.filter((s) => s.key === "other" && !s.standard);
  for (const s of unknown) {
    issues.push({
      id: `unknown-heading-${s.startLine}`,
      severity: "low",
      issue: `Unrecognized heading "${s.heading}"`,
      recommendation: "Use a conventional heading (Projects, Certifications, Awards...) or merge it into a standard section.",
    });
  }
  return { score: clamp(pts), why, checks, issues: groupFindings(issues).issues };
}

// ---------- 4. Formatting & parse health (15) ----------

export function scoreFormatting(
  resume: ParsedResume,
  layout: LayoutSignals,
  fileType: string,
  extra?: CheckResult,
  wordCount?: number,
  presence?: ContactPresence[],
  jdTerms: string[] = [],
): { score: number; why: ScoreExplanation[]; checks: DiagnosticCheck[]; issues: FormattingIssue[] } {
  const why: ScoreExplanation[] = [];
  const checks: DiagnosticCheck[] = [];
  const issues: FormattingIssue[] = [];
  // Deductions are collected per finding, then capped per root cause (see findings.ts).
  const deductions: Deduction[] = [];
  const deduct = (n: number, label: string, id: string) => deductions.push({ id, label, points: n });

  // Parse test
  if (layout.columns > 1) {
    deduct(25, "Multi-column layout", "multi-column");
    issues.push({ id: "multi-column", severity: "high", issue: `${layout.columns}-column layout detected`, recommendation: "Use a single-column layout. Many ATS parsers read straight across columns and scramble your content." });
  }
  checks.push({ id: "columns", label: "Single-column layout", status: layout.columns > 1 ? "fail" : "pass", detail: layout.columns > 1 ? `${layout.columns} text columns found.` : fileType === "txt" ? "Plain text (no layout)." : "Content flows in one column." });

  if (layout.hasTables) {
    deduct(15, "Tables", "tables");
    issues.push({ id: "tables", severity: "high", issue: "Table-based layout detected", recommendation: "Replace tables with plain text lines. Cells are often dropped or merged out of order." });
  }
  checks.push({ id: "tables", label: "No tables", status: layout.hasTables ? "fail" : "pass", detail: layout.hasTables ? "Grid/table structure detected." : "No tables found." });

  if (layout.hasTextBoxes) {
    deduct(15, "Text boxes", "text-boxes");
    issues.push({ id: "text-boxes", severity: "high", issue: "Text boxes detected", recommendation: "Move content out of text boxes into the main body. Most ATS skip floating text boxes entirely." });
  }
  checks.push({ id: "text-boxes", label: "No text boxes", status: layout.hasTextBoxes ? "fail" : "pass", detail: fileType === "pdf" ? "Not reliably detectable in PDF; checked for DOCX only." : layout.hasTextBoxes ? "Floating text boxes found." : "None found." });

  // A single logo in the header band, clear of any text, with the text layer intact, doesn't hide
  // content from an ATS: it's a low finding. Anything else (photos, icons, skill bars, images
  // over text) keeps the full one.
  const headerLogo =
    layout.imageCount === 1 && layout.images?.length === 1 && layout.images[0].headerBand && !layout.images[0].overlapsText && layout.hiddenTextChars === 0;
  if (layout.imageCount > 0 && headerLogo) {
    deduct(2, "Logo in the header band", "images");
    issues.push({ id: "images", severity: "low", issue: "1 logo/image in the header band, clear of the text", recommendation: "Fine for most ATS since no text sits inside it; remove it if you want a fully plain file." });
  } else if (layout.imageCount > 0) {
    deduct(Math.min(15, 5 + layout.imageCount * 2), "Images / graphics", "images");
    issues.push({ id: "images", severity: "medium", issue: `${layout.imageCount} image(s) or graphic element(s) found`, recommendation: "Remove photos, icons, logos and skill-bar graphics. ATS can't read them and they can break parsing." });
  }
  checks.push({ id: "images", label: "No images or icons", status: layout.imageCount ? "warn" : "pass", detail: layout.imageCount ? `${layout.imageCount} image(s).` : "None found." });

  // Contact details
  const hf = layout.headerFooterText;
  const contactInHF = !!hf && (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(hf) || !!findPhone(hf) || /linkedin\.com/i.test(hf));
  if (contactInHF) {
    deduct(20, "Contact info in header/footer", "contact-header");
    issues.push({ id: "contact-header", severity: "high", issue: "Contact details detected inside the page header/footer area", recommendation: "Move your name, email, phone and LinkedIn into the main document body. Many ATS ignore headers and footers." });
  }
  // This check can only pass when there is contact info to be in the body: with neither an
  // email nor a phone anywhere it fails too (penalised once, under missing-email/phone).
  const noContact = !resume.contact.email && !resume.contact.phone;
  checks.push({
    id: "contact-header",
    label: "Contact info in body (not header/footer)",
    status: contactInHF || noContact ? "fail" : "pass",
    detail: contactInHF
      ? `Found in header/footer: "${hf.slice(0, 80)}"`
      : noContact
        ? `No email or phone anywhere (searched ${PLACES_SEARCHED}).`
        : "Contact details sit in the main body.",
  });

  // Each detail is searched everywhere (body, tables, text boxes, header, footer, link targets).
  // "absent" and "could not read" are separate findings; all of them belong to one root cause
  // (contact), so the penalty is applied once and capped (findings.ts).
  const c = resume.contact;
  const contactChecks: [keyof typeof c, string, number, FormattingIssue["severity"]][] = [
    ["name", "Name", 5, "medium"],
    ["email", "Email", 10, "high"],
    ["phone", "Phone number", 8, "high"],
    ["linkedin", "LinkedIn URL", 4, "low"],
  ];
  for (const [k, label, n, sev] of contactChecks) {
    // The Name check validates the value, not just its presence: a heading, skill phrase,
    // JD keyword or single word fails (counted like a missing name, same root cause).
    if (k === "name") {
      const problem = nameProblem(c.name, jdTerms);
      checks.push({ id: "contact-name", label, status: problem ? "fail" : "pass", detail: problem ? `Not a valid name: ${problem}.` : String(c.name) });
      if (problem) {
        deduct(n, c.name ? "Name not recognised" : "Missing name", "missing-name");
        issues.push({
          id: "missing-name",
          severity: sev,
          issue: c.name ? `Name not recognised (${problem})` : "Name not detected",
          recommendation: "Put your full name as the first line of the body, in plain text (not in a header, table or text box).",
        });
      }
      continue;
    }
    const pres = presence?.find((x) => x.field === k);
    const what = k === "linkedin" ? "LinkedIn URL" : label.toLowerCase();
    if (pres?.state === "could not read") {
      checks.push({ id: `contact-${k}`, label, status: "warn", detail: `Could not read: found "${pres.clue}" but no usable ${what}.` });
      deduct(n, `Unreadable ${label.toLowerCase()}`, `unreadable-${k}`);
      issues.push({ id: `unreadable-${k}`, severity: sev, issue: `${label} could not be read (found "${pres.clue}")`, recommendation: `Write your ${what} out in full as plain text near the top; an ATS can't read it in its current form.` });
      continue;
    }
    const ok = !!c[k];
    const where = pres?.where && pres.where !== "body" ? ` (only in the ${pres.where})` : "";
    checks.push({
      id: `contact-${k}`,
      label,
      status: ok ? (where ? "warn" : "pass") : k === "linkedin" ? "warn" : "fail",
      detail: ok ? `${c[k]}${where}` : `Absent: not in the ${PLACES_SEARCHED}.`,
    });
    if (!ok) {
      deduct(n, `Missing ${label.toLowerCase()}`, `missing-${k}`);
      issues.push({ id: `missing-${k}`, severity: sev, issue: `${label} absent (searched ${PLACES_SEARCHED})`, recommendation: `Add your ${what} as plain text near the top of the resume.` });
    } else if (where && pres?.where !== "header/footer") {
      // Header/footer placement is reported once above (contact-header). No extra deduction:
      // tables, text boxes and links are already penalised under the layout root cause.
      issues.push({ id: `contact-hidden-${k}`, severity: "low", issue: `${label} found only in the ${pres!.where}`, recommendation: `Also write your ${what} as plain text in the body; many ATS skip ${pres!.where === "link target" ? "hyperlink targets" : "tables and text boxes"}.` });
    }
  }

  // Dates
  const undated = resume.roles.filter((r) => !r.dates).length;
  if (resume.dateFormats.length > 1) {
    deduct(8, "Mixed date formats", "date-mixed");
    issues.push({ id: "date-mixed", severity: "medium", issue: `Mixed date formats: ${resume.dateFormats.join(", ")}`, recommendation: 'Use one format throughout, e.g. "Jan 2021 – Present" or "01/2021 – Present".' });
  }
  if (resume.unparsedDates.length) {
    deduct(8, "Unparseable dates", "date-unparsed");
    issues.push({ id: "date-unparsed", severity: "medium", issue: `Dates an ATS may not parse: ${resume.unparsedDates.slice(0, 4).join(", ")}`, recommendation: "Replace seasons, quarters and abbreviated years ('19) with Month YYYY or MM/YYYY." });
  }
  const datedRoles = resume.roles.filter((r) => r.dates).length;
  if (!datedRoles && resume.sections.some((s) => s.key === "experience")) {
    deduct(12, "No parseable role dates", "date-none");
    issues.push({ id: "date-none", severity: "high", issue: "No parseable employment dates found", recommendation: 'Add a date range to every role (e.g. "Mar 2020 – Present") so the ATS can calculate your experience.' });
  } else if (undated) {
    deduct(5, "Roles without dates", "undated");
  }
  checks.push({
    id: "dates",
    label: "Consistent, parseable dates",
    status: !datedRoles ? "fail" : resume.dateFormats.length > 1 || resume.unparsedDates.length ? "warn" : "pass",
    detail: datedRoles ? `${datedRoles} dated role(s); format${resume.dateFormats.length > 1 ? "s" : ""}: ${resume.dateFormats.join(", ") || "—"}${resume.unparsedDates.length ? `; unparseable: ${resume.unparsedDates.join(", ")}` : ""}.` : "No date ranges detected.",
  });

  if (layout.pageCount > 2) {
    deduct(4, "Length > 2 pages", "length");
    issues.push({ id: "length", severity: "low", issue: `${layout.pageCount} pages long`, recommendation: "Keep it to 1-2 pages; trim older roles to one line each." });
  }
  if (wordCount !== undefined) {
    // ~400-800 words fits one page; senior candidates can stretch to ~1,100 over two.
    const max = resume.totalYears >= 10 ? 1100 : 850;
    const status = wordCount < 250 || wordCount > max ? "warn" : "pass";
    checks.push({ id: "word-count", label: "Resume length (word count)", status, detail: `${wordCount} words${layout.pageCount ? `, ${layout.pageCount} page${layout.pageCount > 1 ? "s" : ""}` : ""}.` });
    if (wordCount < 250) issues.push({ id: "word-count", severity: "medium", issue: `Only ${wordCount} words`, recommendation: "Thin resumes give the ATS few keywords to match. Aim for roughly 400-800 words." });
    else if (wordCount > max) issues.push({ id: "word-count", severity: "low", issue: `${wordCount} words is long`, recommendation: `Aim for under ~${max} words; cut older roles and repeated points.` });
  }

  if (extra) {
    checks.push(...extra.checks);
    issues.push(...extra.issues);
    for (const d of extra.deductions) deduct(d.points, d.label, d.id);
  }

  // One capped penalty per root cause: a resume missing email, phone and LinkedIn has one
  // problem ("no contact details in the body"), not three stacked deductions.
  const grouped = groupFindings(issues, deductions);
  for (const b of grouped.breakdown)
    why.push({ label: b.title, value: b.applied < b.raw ? `−${b.applied} (capped from −${b.raw})` : `−${b.applied}` });
  if (!why.length) why.push({ label: "No parse risks found", value: "100" });
  return { score: clamp(100 - grouped.penalty), why, checks, issues: grouped.issues };
}

// ---------- 5. Bullet impact (10) ----------

export function auditBullets(resume: ParsedResume): BulletAudit[] {
  return resume.roles.flatMap((r) =>
    r.bullets.map((b) => {
      const strong = startsWithStrongVerb(b);
      const weak = weakPhraseOf(b);
      const metric = hasMetric(b);
      const lengthOk = b.split(/\s+/).length >= 8 && b.split(/\s+/).length <= 40;
      const score = (strong ? 45 : weak ? 0 : 20) + (metric ? 45 : 0) + (lengthOk ? 10 : 0);
      // metricOptional is advice only: the impact score below is unchanged.
      return { text: b, role: r.title || r.company || "Experience", strongVerb: strong, weakPhrase: weak, hasMetric: metric, metricOptional: !metric && metricOptional(b), score };
    }),
  );
}

export function scoreImpact(audit: BulletAudit[]): { score: number; why: ScoreExplanation[] } {
  if (!audit.length) return { score: 20, why: [{ label: "No bullet points detected under experience", value: "20 (floor)" }] };
  const verbRatio = audit.filter((a) => a.strongVerb).length / audit.length;
  const metricRatio = audit.filter((a) => a.hasMetric).length / audit.length;
  const weakRatio = audit.filter((a) => a.weakPhrase).length / audit.length;
  // Full marks at 80% strong openers and 60% quantified bullets; weak openers subtract.
  const score = clamp(Math.min(1, verbRatio / 0.8) * 50 + Math.min(1, metricRatio / 0.6) * 50 - weakRatio * 15);
  return {
    score,
    why: [
      { label: "Bullets starting with strong action verbs", value: `${pct(verbRatio * 100)} (target 80%)` },
      { label: "Bullets with quantified metrics", value: `${pct(metricRatio * 100)} (target 60%)` },
      { label: "Weak openers (\"Responsible for\", \"Worked on\"...)", value: `${audit.filter((a) => a.weakPhrase).length}` },
    ],
  };
}

/** Weights for general mode (no JD): resume quality only. */
export const GENERAL_WEIGHTS = { sectionStructure: 25, formattingHealth: 30, bulletImpact: 25, writingQuality: 20 } as const;

export function overall(scores: CategoryScores, writingQuality: number): { overall: number; weighted: CategoryScores; weights: Record<keyof CategoryScores | "writingQuality", number> } {
  const general = scores.hardSkills === null || scores.experienceAlignment === null;
  const weights: Record<keyof CategoryScores | "writingQuality", number> = general
    ? { hardSkills: 0, experienceAlignment: 0, ...GENERAL_WEIGHTS }
    : { ...WEIGHTS, writingQuality: 0 };
  const keys = Object.keys(WEIGHTS) as (keyof CategoryScores)[];
  const weighted = Object.fromEntries(
    keys.map((k) => [k, scores[k] === null ? null : Math.round(((scores[k] as number) * weights[k]) / 10) / 10]),
  ) as unknown as CategoryScores;
  const total = keys.reduce((a, k) => a + ((scores[k] ?? 0) * weights[k]) / 100, 0) + (writingQuality * weights.writingQuality) / 100;
  return { overall: clamp(total), weighted, weights };
}

export function band(score: number): "low" | "moderate" | "high" {
  return score >= 75 ? "high" : score >= 60 ? "moderate" : "low";
}
