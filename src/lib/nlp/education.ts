import type { EducationRequirement, ParsedResume } from "../types";

// Degree levels: 1 high school, 2 associate, 3 bachelor's, 4 master's/MBA, 5 doctorate.
export const LEVEL_LABEL: Record<number, string> = {
  1: "High school diploma",
  2: "Associate degree",
  3: "Bachelor's degree",
  4: "Master's degree",
  5: "Doctorate (PhD)",
};

/**
 * Degree abbreviations and names → level. Keys are normalized: lowercase, dots removed, and
 * "B. Tech." / "M Sc" joined ("btech", "msc"). Extend here, not in regexes.
 */
export const DEGREE_DICTIONARY: Record<string, number> = {
  // Doctorate
  phd: 5, dphil: 5, edd: 5, dba: 5, doctorate: 5, md: 5, jd: 5,
  // Master's level (incl. Indian postgraduate management programmes)
  mba: 4, emba: 4, pgpm: 4, pgdm: 4, pgp: 4, pgdba: 4, pgpx: 4, pgdbm: 4, pgpba: 4, mim: 4, msc: 4, ms: 4, ma: 4,
  mtech: 4, me: 4, meng: 4, mca: 4, mcom: 4, llm: 4, mph: 4, mfa: 4, mpp: 4, mphil: 4, march: 4, mpharm: 4, mdes: 4,
  master: 4, masters: 4,
  // Bachelor's level
  btech: 3, be: 3, beng: 3, bs: 3, bsc: 3, ba: 3, bba: 3, bbm: 3, bca: 3, bcom: 3, llb: 3, bfa: 3, barch: 3,
  bpharm: 3, bdes: 3, mbbs: 3, bms: 3, ab: 3, bachelor: 3, bachelors: 3,
  // Associate / diploma
  aa: 2, as: 2, aas: 2, associate: 2, diploma: 2,
  // School
  "12th": 1, hsc: 1, "class xii": 1, intermediate: 1, ged: 1, "high school": 1, "higher secondary": 1, "10th": 1, ssc: 1, "class x": 1,
};

// Short, ambiguous keys that need an academic context on the line ("MS Office", "BA" in "BAU").
const AMBIGUOUS_DEGREE = new Set(["ms", "ma", "me", "ba", "bs", "be", "as", "aa", "ab", "md", "jd", "march", "diploma", "intermediate"]);

/** "B. Tech." → "btech", "M.Sc" → "msc", "Master's" → "masters". */
function normalizeDegreeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\./g, "")
    .replace(/\b([bm])\s+(tech|sc|com|e|a|s|eng|arch|pharm|des|ba|ca|fa|phil)\b/g, "$1$2")
    .replace(/\bph\s*d\b/g, "phd")
    .replace(/\s+/g, " ");
}

export interface EducationEntry {
  level: number;
  label: string;
  /** The degree as written ("PGPM", "B. Tech."). */
  degree: string;
  detail: string;
  year: number | null;
  /** Graduation year in the future. */
  inProgress: boolean;
  status: "completed" | "in progress";
  /** 10th / 12th / high school: a school entry, never reported as the highest degree. */
  school: boolean;
}

/** The highest real degree (school entries such as 10th/12th never count), or null. */
export function highestDegree<T extends { level: number }>(entries: T[]): T | null {
  return entries.find((e) => e.level > 1) ?? null;
}

/** One wording for a degree everywhere it's shown: "Master's degree (PGPM, expected 2027)". */
export function describeEducation(e: Pick<EducationEntry, "label" | "degree" | "year" | "inProgress">): string {
  const when = e.year ? (e.inProgress ? `expected ${e.year}` : String(e.year)) : null;
  return `${e.label} (${[e.degree, when].filter(Boolean).join(", ")})${e.inProgress ? ", in progress" : ""}`;
}

/** Degrees found in the resume's education section (or academic-looking lines), highest level first. */
export function resumeEducation(resume: ParsedResume): EducationEntry[] {
  const sec = resume.sections.filter((s) => s.key === "education").flatMap((s) => s.lines);
  const lines = sec.length ? sec : resume.lines.filter((l) => /university|college|institute|school|degree|\bb\.?\s?tech|\bmba\b|\bpg[pd]m\b/i.test(l));
  const thisYear = new Date().getFullYear();
  const out: EducationEntry[] = [];
  for (const line of lines) {
    const norm = normalizeDegreeText(line);
    const academic = /(university|college|institute|school|degree|science|arts|engineering|business|management|technology|\d{4}|cgpa|gpa|%)/i.test(line);
    let best: { level: number; key: string } | null = null;
    for (const [key, level] of Object.entries(DEGREE_DICTIONARY)) {
      if (!new RegExp(`(^|[^a-z0-9])${key.replace(/ /g, "\\s")}([^a-z0-9]|$)`).test(norm)) continue;
      if (AMBIGUOUS_DEGREE.has(key) && !academic) continue;
      if (!best || level > best.level) best = { level, key };
    }
    if (!best) continue;
    const years = (line.match(/\b(19[5-9]\d|20\d{2})\b/g) ?? []).map(Number);
    const year = years.length ? Math.max(...years) : null;
    const m = line.match(new RegExp(best.key.split("").map((ch) => (/[a-z]/.test(ch) ? `${ch}\\.?\\s?` : ch)).join(""), "i"));
    let written = m?.[0]?.trim() ?? best.key.toUpperCase();
    // Keep a programme name given in brackets right after the degree: "MBA (PGPM)".
    const bracket = m && m.index !== undefined ? line.slice(m.index + m[0].length).match(/^\s*\(([^)]{2,12})\)/) : null;
    if (bracket && DEGREE_DICTIONARY[normalizeDegreeText(bracket[1]).trim()] === best.level) written = `${written} (${bracket[1]})`;
    out.push({ level: best.level, label: LEVEL_LABEL[best.level], degree: written, detail: line.slice(0, 140), year, inProgress: year !== null && year > thisYear, status: year !== null && year > thisYear ? "in progress" : "completed", school: best.level === 1 });
  }
  // Highest level first; among equals, the most recent.
  return out.sort((a, b) => b.level - a.level || (b.year ?? 0) - (a.year ?? 0));
}

// JD-side patterns are case-insensitive prose ("a bachelor's degree in computer science").
const JD_DEGREES: [number, RegExp][] = [
  [5, /\b(ph\.?\s?d|doctorate|doctoral degree)\b/i],
  [4, /\b(master'?s|masters|mba|pgdm|pgpm|post[- ]?graduate|m\.s\.|graduate degree|advanced degree)\b/i],
  [3, /\b(bachelor'?s|bachelors|b\.s\.|b\.a\.|undergraduate degree|4[- ]year degree|four[- ]year degree|college degree|university degree|degree in)\b/i],
  [2, /\b(associate'?s degree|2[- ]year degree|two[- ]year degree)\b/i],
  [1, /\b(high school diploma|ged)\b/i],
];

const FIELD_RE = /degree in ([A-Za-z ,/&-]{3,80}?)(?:[.;)]|\bor\b (?:equivalent|related)|$)/i;

export function jdEducation(jdRaw: string): EducationRequirement | null {
  // Curly apostrophes ("Master’s") must not defeat the patterns.
  const jd = jdRaw.replace(/[’‘`]/g, "'");
  // An explicit "Education:" line is authoritative; otherwise scan every sentence.
  const eduLines = jd.split("\n").filter((l) => /^\s*(education(al)?( requirements?| qualifications?)?|qualifications?)\s*[:\-–]/i.test(l));
  const sentences = (eduLines.length ? eduLines.join("\n") : jd).split(/\n|(?<=[a-z]{2}[.;])\s+/);
  let best: EducationRequirement | null = null;
  for (const s of sentences) {
    for (const [level, re] of JD_DEGREES) {
      if (!re.test(s)) continue;
      const preferred = /(preferred|a plus|nice to have|bonus|ideally|desired)/i.test(s);
      const equivalent = /(or equivalent|equivalent (practical |work |professional )?experience|or related experience|in lieu of)/i.test(s);
      const fields = (s.match(FIELD_RE)?.[1] ?? "")
        .split(/,|\bor\b|\/|\band\b/)
        .map((f) => f.trim())
        .filter((f) => f && f.length < 40 && !/related|similar|equivalent|field/i.test(f));
      const req: EducationRequirement = { level, label: LEVEL_LABEL[level], required: !preferred, equivalentExperienceOk: equivalent, fields };
      // Keep the lowest *required* level; a preferred master's doesn't raise the bar.
      if (!best || (req.required && (!best.required || level < best.level)) || (!best.required && !req.required && level > best.level)) best = req;
      break;
    }
  }
  return best;
}

/** 0-100 education fit, or null when the JD sets no education requirement. */
export function scoreEducation(req: EducationRequirement | null, have: { level: number; inProgress?: boolean; year?: number | null }[]): { score: number | null; detail: string } {
  if (!req) return { score: null, detail: "JD states no education requirement" };
  const top = have[0]?.level ?? 0;
  const need = req.label + (req.required ? "" : " (preferred)");
  if (top >= req.level && have[0]?.inProgress) return { score: 90, detail: `${LEVEL_LABEL[top]} in progress (${have[0].year}) for "${need}"` };
  if (top >= req.level) return { score: 100, detail: `${LEVEL_LABEL[top]} meets "${need}"` };
  if (!req.required) return { score: 80, detail: `"${need}" is only preferred; you show ${top ? LEVEL_LABEL[top] : "no degree"}` };
  if (req.equivalentExperienceOk) return { score: top ? 75 : 50, detail: `Below "${need}", but the JD accepts equivalent experience` };
  if (!top) return { score: 0, detail: `No degree detected; JD requires ${need}` };
  return { score: req.level - top === 1 ? 45 : 15, detail: `${LEVEL_LABEL[top]} vs required ${need}` };
}
