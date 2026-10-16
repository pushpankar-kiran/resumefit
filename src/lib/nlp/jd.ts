import type { JDKeyword, Priority, StructuredJD } from "../types";
import { SKILLS, canonicalOf, siblingsOf, synonymsOf } from "./skills";
import { findTerm, isBullet, stripBullet } from "./text";
import { detectLanguage } from "./language";
import { jdEducation } from "./education";

type Block = "must" | "nice" | "resp" | "about" | "none";

const MUST_HEAD = /(requirements|required|qualifications|must[- ]haves?|what you('ll)? (need|bring)|you have|you bring|minimum|basic qualifications|essential|who you are|skills|what we('re)? look(ing)? for|about you|your profile|experience|attributes|competenc|education|eligibility)/i;
const NICE_HEAD = /(prefer|nice[- ]to[- ]haves?|bonus|plus|desired|good to have|additional|extra credit|ideally|it'?s a plus|would be great)/i;
const RESP_HEAD = /(responsibilit|what you('ll)? do|the role|day[- ]to[- ]day|duties|about the role|you will|in this role|your impact|what you'll work on|key accountabilities|overview|job description|role summary)/i;
// Company blurbs, legal text and logistics: never a source of required skills.
const ABOUT_HEAD = /(^about\b|about us|about the company|who we are|benefits|perks|what we offer|compensation|equal opportunit|eeo|our values|why join|disclaimer|legal notice|privacy|joining location|^location|how to apply)/i;
// "Nice to have" cues apply to the clause they sit in ("..., big data is plus").
const NICE_CUE = /(preferred|preferably|a plus|is plus|are plus|nice to have|bonus|ideally|familiarity with|exposure to|good to have|desirable|would be great|advantageous|is an advantage)/i;

/** URLs and email addresses are never skills ("https://..." must not yield "HTTP"). */
export function stripNoise(jd: string): string {
  return jd
    .replace(/[’‘]/g, "'")
    .replace(/\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi, (m) => " ".repeat(m.length))
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => " ".repeat(m.length));
}

/**
 * Department / team enumerations name parts of the org, not skills: "coordinate teams across
 * Technology, Facilities, Procurement, Information Security, and Operations" must not yield
 * "Security". The list is blanked (same length) so offsets still line up.
 */
export function blankOrgLists(jd: string): string {
  const item = String.raw`[A-Z][\w&/-]*(?:\s+(?:&\s+)?[A-Z][\w&/-]*)*`;
  const re = new RegExp(
    String.raw`\b(?:teams?|departments?|functions?|groups?|business units?|divisions?)\s+(?:across|from|in|such as|including|like|spanning)\s+(` +
      `${item}(?:\\s*,\\s*${item})+,?\\s*(?:and|&)\\s+${item})`,
    "g",
  );
  return jd.replace(re, (m, list: string) => m.slice(0, m.length - list.length) + " ".repeat(list.length));
}

/** "About Accenture: Accenture is..." → the inline heading "About Accenture". */
function inlineHeading(line: string): string | null {
  const m = line.match(/^\s*([A-Z][A-Za-z0-9 &()'/,-]{2,60}?)\s*:\s*(\S.*)?$/);
  if (!m || m[1].split(/\s+/).length > 6) return null;
  return m[1];
}

function classifyBlock(label: string): Block | null {
  if (ABOUT_HEAD.test(label) && !/about (the )?role|about you/i.test(label)) return "about";
  if (NICE_HEAD.test(label)) return "nice";
  if (RESP_HEAD.test(label)) return "resp";
  if (MUST_HEAD.test(label)) return "must";
  return null;
}

/** Is a keyword hit at `pos` in a "nice to have" clause of this line? */
function niceClause(line: string, pos: number): boolean {
  const clauses = line.split(/(?<=[,;()])|(?=[()])/);
  let at = 0;
  for (const c of clauses) {
    if (pos >= at && pos < at + c.length) return NICE_CUE.test(c);
    at += c.length;
  }
  return NICE_CUE.test(line);
}

const TITLE_WORDS =
  /\b(engineer|developer|manager|analyst|director|lead|designer|consultant|specialist|associate|scientist|architect|officer|coordinator|administrator|head|vp|strategist|researcher|programmer|recruiter|accountant|marketer|writer|owner|intern)\b/i;

const NOT_TECH = new Set([
  "US", "USA", "UK", "EU", "EEO", "CEO", "CTO", "CFO", "COO", "VP", "HR", "PTO", "IT", "OR", "AND", "THE", "OUR", "WE",
  "YOU", "NA", "APAC", "EMEA", "LGBTQ", "ADA", "FAQ", "ID", "OK", "TBD", "ASAP", "FTE", "WFH", "BS", "BA", "MS", "MBA",
  "PHD", "GPA", "Q1", "Q2", "Q3", "Q4", "AI", "PM", "SF", "NYC", "LA", "TX", "CA", "NY", "WA", "INC", "LLC", "LTD",
]);

function blockOf(line: string): Block | null {
  const l = line.trim().replace(/[:\s]+$/, "");
  if (!l || l.length > 70 || isBullet(l) || l.split(/\s+/).length > 9) return null;
  if (/[.]$/.test(l)) return null;
  // Requirement sentences ("Experience with GraphQL is a plus") are not headings.
  const explicit = /:\s*$/.test(line.trim());
  if (!explicit && (/\d/.test(l) || l.split(/\s+/).length > 6 || /\b(with|is|are|using|including|in|of)\b/i.test(l.replace(/^(about|what|who)\b.*/i, "")))) return null;
  return classifyBlock(l);
}

export function extractTitle(jd: string): string {
  const lines = jd.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const l of lines.slice(0, 15)) {
    const m = l.match(/^(?:job\s+title|position|role|title|job)\s*[:\-–]\s*(.+)$/i);
    if (m) return clean(m[1]);
  }
  for (const l of lines.slice(0, 5)) {
    if (TITLE_WORDS.test(l) && l.split(/\s+/).length <= 10 && !/[.!?]$/.test(l)) return clean(l.split(/\s[-–|@]\s|,\s/)[0]);
  }
  const m = jd.match(/(?:hiring|looking for|seeking|searching for)\s+(?:an?|our next|a talented|an experienced)?\s*([A-Z][\w/&+ -]{3,60}?)(?=\s+(?:to|who|with|that|in|at|for)\b|[,.])/);
  if (m && TITLE_WORDS.test(m[1])) return clean(m[1]);
  return "";
}

function clean(t: string) {
  return t.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}

export function extractYears(jd: string): number | null {
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)(?:'|’)?(?:\s+of)?/gi;
  let best: number | null = null;
  for (const m of jd.matchAll(re)) {
    const ctx = jd.slice(m.index!, m.index! + 90).toLowerCase();
    if (/(old|ago|history|founded|anniversary|warranty)/.test(ctx)) continue;
    const n = Number(m[1]);
    if (n > 0 && n <= 25) best = best === null ? n : Math.max(best, n);
  }
  return best;
}

export function extractSeniority(jd: string, title: string): string | null {
  const s = `${title} ${jd.slice(0, 600)}`.toLowerCase();
  for (const [re, label] of [
    [/\b(principal|distinguished)\b/, "Principal"],
    [/\bstaff\b/, "Staff"],
    [/\b(director|head of|vp)\b/, "Director+"],
    [/\b(senior|sr\.?)\b/, "Senior"],
    [/\blead\b/, "Lead"],
    [/\b(junior|jr\.?|entry[- ]level|graduate|new grad)\b/, "Junior"],
    [/\b(intern|internship)\b/, "Intern"],
    [/\bmid[- ]level\b/, "Mid-level"],
  ] as [RegExp, string][])
    if (re.test(s)) return label;
  return null;
}

/** Deterministic JD structuring: section-aware keyword extraction against the taxonomy. */
export function structureJDHeuristic(jdRaw: string): StructuredJD {
  // Same length as the raw JD (noise is blanked, not removed), so offsets still line up.
  const jd = blankOrgLists(stripNoise(jdRaw));
  const lines = jd.split("\n");
  const lineBlock: Block[] = [];
  let block: Block = "none";
  for (const line of lines) {
    // Headings can be their own line ("Requirements:") or inline ("About Accenture: Accenture is...").
    const inline = inlineHeading(line);
    const b = blockOf(line) ?? (inline ? classifyBlock(inline) : null);
    if (b) block = b;
    else if (inline) block = "none"; // an unrecognised inline heading ends the previous section
    lineBlock.push(block);
  }
  const offsets: number[] = [];
  let off = 0;
  for (const l of lines) {
    offsets.push(off);
    off += l.length + 1;
  }
  const lineAt = (idx: number) => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const found = new Map<string, { kw: JDKeyword; votesMust: number; votesNice: number; count: number }>();
  const consider = (term: string, aliases: string[], category: JDKeyword["category"], variants: string[]) => {
    for (const v of variants) {
      for (const hit of findTerm(jd, v)) {
        const li = lineAt(hit.index);
        const b = lineBlock[li];
        if (b === "about") continue;
        const entry = found.get(term) ?? { kw: { term, aliases, category, priority: "must" as Priority }, votesMust: 0, votesNice: 0, count: 0 };
        entry.count++;
        if (b === "nice" || niceClause(lines[li], hit.index - offsets[li])) entry.votesNice++;
        else entry.votesMust++;
        found.set(term, entry);
      }
    }
  };

  for (const s of SKILLS) {
    consider(s.term, synonymsOf(s), s.category, [s.term, ...synonymsOf(s)]);
    for (const sib of siblingsOf(s)) consider(canonicalOf(sib).term, [], s.category, [sib]);
  }

  // Tech-looking tokens outside the taxonomy (CamelCase products, *.js, short acronyms in lists).
  const known = new Set(SKILLS.flatMap((s) => [s.term, ...s.aliases].map((x) => x.toLowerCase())));
  lines.forEach((line, li) => {
    const b = lineBlock[li];
    if (b === "about" || b === "none" || b === "resp") return;
    const cands = [
      ...(line.match(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g) ?? []),
      ...(line.match(/\b[\w-]+\.(?:js|io|ai)\b/g) ?? []),
      ...(line.match(/(?<=[,(/]\s?|:\s)[A-Z]{2,6}\b(?=\s?[,)/])/g) ?? []),
    ];
    for (const c of cands) {
      if (NOT_TECH.has(c) || known.has(c.toLowerCase()) || found.has(c)) continue;
      found.set(c, {
        kw: { term: c, aliases: [], category: "tool", priority: "must" },
        votesMust: b === "nice" || NICE_CUE.test(line) ? 0 : 1,
        votesNice: b === "nice" || NICE_CUE.test(line) ? 1 : 0,
        count: 1,
      });
    }
  });

  const keywords = [...found.values()].map(({ kw, votesMust, votesNice }) => ({
    ...kw,
    priority: (votesMust > 0 ? "must" : votesNice > 0 ? "nice" : "must") as Priority,
  }));

  // A keyword that subsumes another (e.g. "AWS Lambda" and "AWS") stays separate on purpose:
  // ATS keyword lists treat them as distinct strings.
  const resp = lines
    .map((l, i) => ({ l, b: lineBlock[i] }))
    .filter(({ l, b }) => b === "resp" && isBullet(l))
    .map(({ l }) => stripBullet(l))
    .slice(0, 12);

  const title = extractTitle(jd);
  return {
    targetTitle: title,
    experienceYears: extractYears(jd),
    experiencePreferred: (() => {
      const y = extractYears(jd);
      if (y === null) return false;
      const li = lines.findIndex((l) => new RegExp(`\\b${y}\\s*\\+?\\s*(?:-|–|to)?[^\\n]{0,8}(years?|yrs?)`, "i").test(l));
      return li >= 0 && lineBlock[li] === "nice";
    })(),
    seniority: extractSeniority(jd, title),
    education: jdEducation(jd),
    keywords: dedupe(keywords),
    responsibilities: resp,
    language: detectLanguage(jd).language,
    source: "heuristic",
  };
}

/** Collapse duplicates that resolve to the same taxonomy skill. */
export function dedupe(list: JDKeyword[]): JDKeyword[] {
  const out = new Map<string, JDKeyword>();
  for (const k of list) {
    const { term, def } = canonicalOf(k.term);
    const key = term.toLowerCase();
    const prev = out.get(key);
    const isCanonical = def && def.term === term;
    if (!prev) {
      out.set(key, {
        ...k,
        term,
        aliases: [...new Set([...(k.aliases ?? []), ...(isCanonical ? synonymsOf(def) : [])])],
        category: def?.category ?? k.category,
      });
    } else {
      if (k.priority === "must") prev.priority = "must";
      prev.aliases = [...new Set([...prev.aliases, ...k.aliases])];
    }
  }
  return [...out.values()];
}
