import type { ContactInfo, ParsedResume, ResumeSection, Role, SectionKey } from "../types";
import { findDateRanges, findUnparseableDates, formatFamily, totalYears } from "./dates";
import { isBullet, stripBullet } from "./text";
import { findSkill } from "./skills";

type Key = SectionKey | "other";

// Standard (ATS-safe) headings per section.
const STANDARD: Record<SectionKey, string[]> = {
  contact: ["contact", "contact information", "contact info", "contact details", "personal information", "personal details"],
  summary: [
    "summary", "professional summary", "profile", "professional profile", "career summary", "executive summary",
    "objective", "career objective", "summary of qualifications", "qualifications summary", "professional overview",
  ],
  experience: [
    "experience", "work experience", "professional experience", "employment history", "work history", "employment",
    "relevant experience", "career history", "professional history", "experience summary",
  ],
  education: [
    "education", "education and training", "education & training", "academic background", "academic qualifications",
    "education and certifications", "education & certifications", "educational background", "academics",
  ],
  skills: [
    "skills", "technical skills", "core competencies", "key skills", "skills and tools", "skills & tools", "competencies",
    "technical proficiencies", "areas of expertise", "core skills", "tools and technologies", "tools & technologies",
    "skills & technologies", "skills and technologies", "technologies", "skills summary", "professional skills",
    "skills & certifications", "skills and certifications",
  ],
};

// Headings ATS parsers commonly fail to map, with the section they were meant to be.
const CREATIVE: Record<SectionKey, string[]> = {
  contact: ["get in touch", "reach me", "find me", "say hello", "let's talk", "lets talk", "connect with me"],
  summary: ["about me", "about", "who i am", "hello", "hi there", "intro", "introduction", "in a nutshell", "elevator pitch", "my story", "a bit about me"],
  experience: [
    "where i've been", "where ive been", "my journey", "career journey", "the journey so far", "what i've done",
    "what ive done", "places i've worked", "places ive worked", "work life", "career path", "professional journey",
    "experience highlights", "my experience", "career highlights", "track record", "my work",
  ],
  education: ["schooling", "where i studied", "learning", "academic journey", "school", "my education", "studies"],
  skills: ["what i know", "toolbox", "my toolbox", "toolkit", "my toolkit", "superpowers", "what i bring", "stack", "things i'm good at", "my skills", "my stack", "expertise"],
};

const OTHER_STANDARD = [
  "certifications", "certification", "licenses and certifications", "licenses & certifications", "projects",
  "key projects", "selected projects", "personal projects", "awards", "honors", "honors and awards", "awards and honors",
  "publications", "volunteer", "volunteering", "volunteer experience", "languages", "interests", "hobbies",
  "achievements", "key achievements", "accomplishments", "leadership", "activities", "extracurricular activities",
  "references", "training", "courses", "coursework", "relevant coursework", "patents", "affiliations",
  "professional affiliations", "memberships", "additional information",
];

const TITLE_WORDS =
  /\b(engineer|developer|manager|analyst|director|lead|designer|consultant|intern|specialist|associate|scientist|architect|officer|coordinator|administrator|head|vp|vice president|president|founder|co-founder|owner|executive|advisor|strategist|researcher|programmer|technician|representative|supervisor|assistant|sde|swe|principal|staff|recruiter|accountant|marketer|writer|editor|product|teacher|nurse|chief|cto|ceo|cfo|coo|qa|tester)\b/i;

function norm(line: string): string {
  return line
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[:|•\-–—_#*=~]+$/g, "")
    .replace(/^[:|•\-–—_#*=~\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heading synonyms ATS map reliably. Matched after normalizing case, punctuation and "&" → "and".
 * Add new conventional headings here.
 */
export const HEADING_SYNONYMS: Record<string, SectionKey | "other"> = {
  "profile summary": "summary",
  "career profile": "summary",
  "summary profile": "summary",
  "professional summary and profile": "summary",
  "about": "summary",
  qualifications: "education",
  "educational qualifications": "education",
  "academic qualifications": "education",
  "academic credentials": "education",
  "education and qualifications": "education",
  "scholastic achievements": "other",
  "academic projects": "other",
  "academic projects training": "other",
  "academic projects and training": "other",
  "projects and training": "other",
  "languages known": "other",
  "language proficiency": "other",
  "awards and achievements": "other",
  "achievements and awards": "other",
  "honors and achievements": "other",
  "positions of responsibility": "other",
  "leadership and responsibilities": "other",
  "extra curriculars": "other",
  "extracurriculars": "other",
  "extra curricular activities": "other",
  "co curricular activities": "other",
  "certifications and trainings": "other",
  "trainings and certifications": "other",
  internships: "other",
  "professional experience": "experience",
  "work history and experience": "experience",
  "key skills": "skills",
  "skills and expertise": "skills",
};

const normSyn = (s: string) =>
  s
    .replace(/&/g, " and ")
    .replace(/[-–/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Degree abbreviations ("PGPM", "B. Tech.") and parenthesised fragments are never headings. */
const NOT_A_HEADING = /^\(.*\)$|^(phd|mba|emba|pgpm|pgdm|pgp|pgdba|ms|msc|ma|mtech|me|mca|mcom|btech|be|bsc|bs|ba|bba|bca|bcom|llb|llm|12th|10th|hsc|ssc)$/;

/**
 * The conventional name of a section, as an ATS files it: Summary, Work Experience, Skills,
 * Education, Projects, Awards, Leadership, Interests, Languages, Certifications...
 */
export function canonicalSection(key: SectionKey | "other", heading: string): string {
  const named: Partial<Record<SectionKey | "other", string>> = { contact: "Contact", summary: "Summary", experience: "Work Experience", skills: "Skills", education: "Education" };
  if (named[key]) return named[key]!;
  const h = normSyn(norm(heading));
  const rules: [RegExp, string][] = [
    [/project/, "Projects"],
    [/award|achievement|honou?r|recognition/, "Awards"],
    [/position|responsibilit|leadership/, "Leadership"],
    [/extra ?curricular|co curricular|interest|hobb|activit/, "Interests"],
    [/language/, "Languages"],
    [/certif|training|course|licen/, "Certifications"],
    [/volunteer|community/, "Volunteering"],
    [/publication|paper/, "Publications"],
    [/intern/, "Work Experience"],
  ];
  for (const [re, name] of rules) if (re.test(h)) return name;
  return heading.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

export function classifyHeading(line: string): { key: Key; standard: boolean } | null {
  const raw = line.trim();
  if (!raw || raw.length > 48 || /[@]|https?:/.test(raw) || isBullet(raw)) return null;
  // Table rows ("Degree | Institute | Year") are cells, never section headings.
  if (/ \| /.test(raw)) return null;
  if (raw.split(/\s+/).length > 6 || /[.!?]$/.test(raw.replace(/[:]$/, ""))) return null;
  const n = norm(raw);
  if (NOT_A_HEADING.test(n.replace(/[.\s]/g, "")) || NOT_A_HEADING.test(n)) return null;
  for (const k of Object.keys(STANDARD) as SectionKey[]) if (STANDARD[k].includes(n)) return { key: k, standard: true };
  const syn = HEADING_SYNONYMS[normSyn(n)];
  if (syn) return { key: syn, standard: true };
  for (const k of Object.keys(CREATIVE) as SectionKey[]) if (CREATIVE[k].includes(n)) return { key: k, standard: false };
  if (OTHER_STANDARD.includes(n) || OTHER_STANDARD.includes(normSyn(n))) return { key: "other", standard: true };
  // Unknown ALL-CAPS short line: very likely a heading, but one the ATS can't map.
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && raw === raw.toUpperCase() && !/\d/.test(raw) && raw.split(/\s+/).length <= 4 && !TITLE_WORDS.test(raw)) {
    return { key: "other", standard: false };
  }
  return null;
}

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,5}){1,3}/g;
export const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/i;

export function findPhone(text: string): string | null {
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) continue;
    // Skip things that are really date ranges or years glued together.
    if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(m[0].trim())) continue;
    return m[0].trim();
  }
  return null;
}

const NOT_NAME = /\b(age|gender|experience|portfolio|months?|years?|phone|email|mobile|address|linkedin|github|batch|resume|curriculum|vitae|cv)\b/i;
// Words that make a short capitalised line a skill or topic, not a person ("PROJECT MANAGEMENT",
// "DIGITAL TRANSFORMATION", "CLOUD & AI APIs").
const SKILL_WORDS =
  /\b(management|manager|development|developer|transformation|strategy|strategic|governance|delivery|analytics|analysis|engineering|marketing|operations|design|apis?|backlog|roadmap|leadership|communication|skills?|solutions?|services|digital|cloud|data|agile|scrum|product|program|project|risk|business|sales|finance|technology|research|consulting|planning|testing|security|automation|innovation)\b/i;

/** 2-4 capitalised alphabetic words that aren't a heading, a skill phrase, a job title or a label. */
export function isNameLike(s: string): boolean {
  const cleaned = s.trim();
  if (!cleaned || NOT_NAME.test(cleaned) || SKILL_WORDS.test(cleaned) || TITLE_WORDS.test(cleaned) || EMAIL_RE.test(cleaned)) return false;
  if (!/^[A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,3}$/.test(cleaned)) return false;
  // Every word capitalised (Title Case or ALL CAPS): rules out sentence fragments.
  if (!cleaned.split(/\s+/).every((w) => /^[A-Z]/.test(w))) return false;
  // An all-caps name looks like an unknown heading; only real sections are excluded.
  const h = classifyHeading(cleaned);
  if (h && (h.key !== "other" || h.standard)) return false;
  return !findSkill(cleaned);
}

/**
 * Why a detected name can't be right, or null if it looks like a name: fewer than 2 alphabetic
 * tokens, a section heading, a skill phrase, a label, or one of the JD's keywords.
 */
export function nameProblem(name: string | null, jdTerms: string[] = []): string | null {
  if (!name) return "no name found above the first section heading";
  const alpha = name.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w));
  if (alpha.length < 2) return `"${name}" has fewer than 2 alphabetic words`;
  const h = classifyHeading(name);
  if (h && (h.key !== "other" || h.standard)) return `"${name}" is a section heading`;
  if (jdTerms.some((t) => t.toLowerCase() === name.toLowerCase())) return `"${name}" is a keyword from the job description`;
  if (findSkill(name) || SKILL_WORDS.test(name)) return `"${name}" is a skill phrase`;
  if (NOT_NAME.test(name)) return `"${name}" is a label, not a name`;
  if (!isNameLike(name)) return `"${name}" doesn't look like a person's name`;
  return null;
}

export function extractContact(text: string, links: string[], nameHint: string | null = null): ContactInfo {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // Hyperlink targets count too: an email written as a "mailto:" link behind display text.
  const email = text.match(EMAIL_RE)?.[0] ?? links.map((l) => l.match(/^mailto:([^?]+)/i)?.[1]).find(Boolean) ?? null;
  const phone = findPhone(text.slice(0, 1500)) ?? links.map((l) => l.match(/^tel:(.+)/i)?.[1]).find(Boolean) ?? null;
  const linkedin = text.match(LINKEDIN_RE)?.[0] ?? links.find((l) => LINKEDIN_RE.test(l)) ?? null;
  let name: string | null = null;
  // Never below the first section heading.
  const firstHeading = lines.findIndex((l) => {
    const h = classifyHeading(l);
    return !!h && (h.key !== "other" || h.standard);
  });
  const top = lines.slice(0, firstHeading >= 0 ? Math.min(firstHeading, 8) : 8);
  // A formatting hint (the largest/boldest short line near the top of a .docx) wins when it
  // passes the same checks and sits above the first heading.
  if (nameHint && isNameLike(nameHint) && top.some((l) => l.includes(nameHint))) name = nameHint;
  // Otherwise: the first 2-4 word capitalised segment above the first section heading. It may
  // sit in any cell of a header table ("Age | Gender: 29 | ... | ANANYA RAO"). Bulleted
  // lines are never names ("• PROJECT MANAGEMENT").
  outer: for (const l of name ? [] : top) {
    if (isBullet(l)) continue;
    for (const seg of l.split(/[|•·,]/)) {
      const cleaned = seg.trim();
      if (isNameLike(cleaned)) {
        name = cleaned;
        break outer;
      }
    }
  }
  const location =
    lines
      .slice(0, 8)
      .filter((l) => !TITLE_WORDS.test(l) || /[|•·]/.test(l))
      .join(" | ")
      .match(/(?:^|[|•·]\s*|\s)([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s?(?:[A-Z]{2}|India|USA|UK|Canada|Germany|Singapore|Australia|UAE|Ireland|Netherlands|France))\b/)?.[1] ?? null;
  return { name, email, phone, linkedin, location };
}

export function parseResume(text: string, links: string[] = [], nameHint: string | null = null): ParsedResume {
  const lines = text.split("\n").map((l) => l.trim());
  const sections: ResumeSection[] = [];
  let current: ResumeSection = { key: "contact", heading: "(top of document)", canonical: "Contact", standard: true, startLine: 0, lines: [] };
  sections.push(current);
  lines.forEach((line, i) => {
    const h = classifyHeading(line);
    if (h) {
      const heading = line.replace(/[:]+$/, "");
      current = { key: h.key, heading, canonical: canonicalSection(h.key, heading), standard: h.standard, startLine: i, lines: [] };
      sections.push(current);
    } else if (line) current.lines.push(line);
  });

  // Unknown headings: infer what they were meant to be from their content.
  for (const s of sections) {
    if (s.key !== "other" || s.standard) continue;
    const body = s.lines.join("\n");
    if (s.lines.some((l) => findDateRanges(l).length) && s.lines.filter(isBullet).length >= 2) s.key = "experience";
    else if (/\b(university|college|bachelor|master|b\.?s\.?c?|m\.?s\.?c?|b\.?tech|m\.?tech|mba|ph\.?d|degree|gpa)\b/i.test(body)) s.key = "education";
    else if ((body.match(/,/g) ?? []).length >= 5 && s.lines.length <= 12) s.key = "skills";
    s.canonical = canonicalSection(s.key, s.heading);
  }

  const contact = extractContact(text, links, nameHint);
  const exp = sections.filter((s) => s.key === "experience");
  const roles = parseRoles(exp.flatMap((s) => s.lines));

  const summarySec = sections.find((s) => s.key === "summary");
  let summary = summarySec ? summarySec.lines.join(" ") : "";
  if (!summary) {
    const top = sections[0].lines.find((l) => l.split(/\s+/).length >= 15 && !EMAIL_RE.test(l));
    summary = top ?? "";
  }

  const expLines = exp.flatMap((s) => s.lines);
  const dateFormats = [...new Set(roles.filter((r) => r.dates).map((r) => formatFamily(r.dates!.format)))];
  const unparsedDates = [...new Set(expLines.flatMap(findUnparseableDates))];

  const bullets = roles.flatMap((r) => r.bullets);
  return {
    text,
    lines,
    sections,
    contact,
    roles,
    bullets,
    summary,
    totalYears: totalYears(roles.map((r) => r.dates).filter((d): d is NonNullable<typeof d> => !!d)),
    dateFormats,
    unparsedDates,
  };
}

/**
 * Split experience lines into roles. A role is anchored on a line carrying a date range; its
 * header is the run of non-bullet lines around that anchor, and its bullets follow.
 */
export function parseRoles(lines: string[]): Role[] {
  const anchors = lines.map((l, i) => (findDateRanges(l).length ? i : -1)).filter((i) => i >= 0);
  const roles: Role[] = [];
  anchors.forEach((a, n) => {
    // Header lines: walk back over non-bullet lines (max 2) not owned by the previous role.
    const prevAnchor = n > 0 ? anchors[n - 1] : -1;
    let hs = a;
    while (hs - 1 > prevAnchor && !isBullet(lines[hs - 1]) && a - (hs - 1) <= 2 && !isProse(lines[hs - 1])) hs--;
    let he = a;
    while (he + 1 < lines.length && he + 1 - a <= 2 && !isBullet(lines[he + 1]) && !isProse(lines[he + 1]) && !findDateRanges(lines[he + 1]).length) he++;
    const end = n + 1 < anchors.length ? startOfHeader(lines, anchors[n + 1], a) : lines.length;
    const bodyLines = lines.slice(he + 1, end);
    let bullets = bodyLines.filter(isBullet).map(stripBullet);
    if (!bullets.length) bullets = bodyLines.filter(isProse);
    const header = lines.slice(hs, he + 1);
    const dates = findDateRanges(lines[a])[0];
    const { title, company } = titleAndCompany(header, dates.raw);
    roles.push({ title, company, dates, bullets, index: n });
  });
  // If no dated roles exist, still capture bullets so impact scoring has something to read.
  if (!roles.length) {
    const bullets = lines.filter(isBullet).map(stripBullet);
    if (bullets.length) roles.push({ title: "", company: "", dates: null, bullets, index: 0 });
  }
  return roles;
}

function startOfHeader(lines: string[], anchor: number, floor: number): number {
  let s = anchor;
  while (s - 1 > floor && !isBullet(lines[s - 1]) && anchor - (s - 1) <= 2 && !isProse(lines[s - 1])) s--;
  return s;
}

function isProse(line: string): boolean {
  return line.split(/\s+/).length >= 9 && /[a-z]/.test(line) && !findDateRanges(line).length;
}

function titleAndCompany(header: string[], dateRaw: string): { title: string; company: string } {
  const parts = header
    .join(" | ")
    .replace(dateRaw, " ")
    .split(/\s*(?:\||•|·|—|–|\s-\s|,|\bat\b|\s{3,})\s*/)
    // Season words left behind by "Summer 2018 – Dec 2020" aren't part of the employer name.
    .map((p) => p.replace(/[()]/g, "").replace(/\s*\b(spring|summer|fall|autumn|winter)\b\s*$/i, "").trim())
    .filter((p) => p && !/^(remote|hybrid|on-?site)$/i.test(p) && !/^[A-Z]{2}$/.test(p) && p.length > 1);
  // With no recognisable title word, the first part is the title, and never also the company
  // ("Senior QA, Northwind Games" → title "Senior QA", company "Northwind Games").
  const found = parts.findIndex((p) => TITLE_WORDS.test(p));
  const titleIdx = found >= 0 ? found : 0;
  const title = parts[titleIdx] ?? "";
  const company = parts.find((p, i) => i !== titleIdx && !TITLE_WORDS.test(p)) ?? "";
  return { title, company };
}
