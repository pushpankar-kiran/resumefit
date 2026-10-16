import type { JDKeyword, KeywordMatch, MatchType, ParsedResume } from "../types";
import { SKILLS, canonicalOf, siblingsOf, synonymsOf } from "./skills";
import { findTerm, jaroWinkler, lemmas, stems, trigramCosine } from "./text";
import ALIAS_FILE from "./aliases.json";

// Credit awarded per match tier. Exact, alias and word-form (the same words in another
// inflection: "prioritizing" for "Prioritization") = full; semantic (typo, derivation,
// re-ordered phrase, model-judged equivalent) = 0.8; related (a sibling listed in the alias
// file's "related" groups, e.g. MySQL for PostgreSQL) = 0.3 partial credit.
export const CREDIT: Record<MatchType, number> = { exact: 1, alias: 1, "word-form": 1, semantic: 0.8, related: 0.3, none: 0 };

// Editable alias file (src/lib/nlp/aliases.json):
//  - synonyms: two-way groups, so each member lists the others;
//  - variants: one-way, the resume wording on the right satisfies the keyword on the left.
const FILE_ALIASES = new Map<string, string[]>();
const addAliases = (key: string, aliases: string[]) => {
  const k = key.toLowerCase();
  FILE_ALIASES.set(k, [...new Set([...(FILE_ALIASES.get(k) ?? []), ...aliases.filter((a) => a.toLowerCase() !== k)])]);
};
const aliasFile = ALIAS_FILE as { synonyms?: Record<string, string[]>; variants?: Record<string, string[]>; related?: Record<string, string[]> };
for (const [k, v] of Object.entries(aliasFile.synonyms ?? {})) for (const t of [k, ...v]) addAliases(t, [k, ...v]);
for (const [k, v] of Object.entries(aliasFile.variants ?? {})) addAliases(k, v);

export function fileAliasesOf(term: string): string[] {
  return FILE_ALIASES.get(term.toLowerCase()) ?? [];
}

const FILE_SYNONYMS = new Map<string, string[]>();
for (const [k, v] of Object.entries(aliasFile.synonyms ?? {}))
  for (const t of [k, ...v]) FILE_SYNONYMS.set(t.toLowerCase(), [k, ...v].filter((x) => x.toLowerCase() !== t.toLowerCase()));
/** Only the two-way synonyms: safe to swap in a rewrite (a one-way variant is not). */
export function fileSynonymsOf(term: string): string[] {
  return FILE_SYNONYMS.get(term.toLowerCase()) ?? [];
}

// Sibling groups: the only source of "related" credit.
const RELATED_GROUPS = Object.values(aliasFile.related ?? {}).map((g) => g.map((x) => x.toLowerCase()));
/** Listed siblings of any of `terms` (never the terms themselves). */
export function relatedSiblingsOf(terms: string[]): string[] {
  const own = new Set(terms.map((t) => t.toLowerCase()));
  return [...new Set(RELATED_GROUPS.filter((g) => g.some((m) => own.has(m))).flat())].filter((m) => !own.has(m));
}

// Generic words never count as the keyword's head: "Time Management" needs "time", not
// "management"; "Problem Solving Skills" needs "problem" or "solving".
const GENERIC_HEAD = new Set(["management", "skill", "skills", "ability", "abilities", "knowledge", "experience", "work"].map((w) => lemmas(w)[0]).filter(Boolean));
/** The keyword's distinctive content lemmas (all of them if every word is generic). */
export function headLemmas(term: string): string[] {
  const ls = lemmas(term.replace(/-/g, " "));
  const specific = ls.filter((l) => !GENERIC_HEAD.has(l));
  return specific.length ? specific : ls;
}
/** At least one head lemma of the keyword appears in the evidence text. */
export function hasHeadEvidence(term: string, evidence: string): boolean {
  const heads = headLemmas(term);
  if (!heads.length) return true;
  const have = new Set(lemmas(evidence.replace(/-/g, " ")));
  return heads.some((h) => have.has(h));
}

/** Hits for an alias with a trailing wildcard: "prioritiz*" → prioritize, prioritized, ... */
function wildcardHits(text: string, variant: string): { index: number; text: string }[] {
  const stemPart = variant.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
  const re = new RegExp(`(?<![A-Za-z0-9])${stemPart}[A-Za-z]*`, "gi");
  return [...text.matchAll(re)].map((m) => ({ index: m.index!, text: m[0] }));
}

interface Tok {
  t: string;
  key: string;
  at: number;
}

/** Content tokens per resume line, keyed by `keyOf` (lemma or stem); stop words dropped. */
function keyedLines(text: string, keyOf: (t: string) => string | undefined): Tok[][] {
  const out: Tok[][] = [];
  let off = 0;
  for (const line of text.split("\n")) {
    const toks: Tok[] = [];
    for (const m of line.matchAll(/[A-Za-z0-9+#./-]+/g)) {
      const t = m[0].replace(/[.,]$/, "");
      const key = keyOf(t);
      if (key) toks.push({ t, key, at: off + m.index! });
    }
    out.push(toks);
    off += line.length + 1;
  }
  return out;
}

/**
 * Every place where all of the phrase's keys sit within a short window on ONE line ("managed
 * key stakeholders" for "Manage Stakeholders"). Matches never span lines, so "RISK MANAGEMENT"
 * + next line's "PROGRAM GOVERNANCE" is not "program management". Returns the matched spans.
 */
function windowHits(lines: Tok[][], text: string, ps: string[], slack: number): { index: number; text: string }[] {
  if (!ps.length) return [];
  const W = ps.length + slack;
  const out: { index: number; text: string }[] = [];
  for (const toks of lines) {
    for (let i = 0; i < toks.length; i++) {
      if (!ps.includes(toks[i].key)) continue;
      const win = toks.slice(i, i + W);
      if (!ps.every((p) => win.some((x) => x.key === p))) continue;
      const last = Math.max(...ps.map((p) => win.findIndex((x) => x.key === p)));
      const end = win[last];
      out.push({ index: toks[i].at, text: text.slice(toks[i].at, end.at + end.t.length) });
      i += last; // non-overlapping
    }
  }
  return out;
}

/** The full resume line containing `index`. */
function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end < 0 ? text.length : end);
}

/**
 * The resume line around a hit, trimmed to ~140 chars, with the matched words in [brackets]
 * as proof of the match: "Owned product backlog as [user stories] and acceptance criteria…".
 */
function evidenceAt(text: string, index: number, length: number): string {
  if (index < 0) return "";
  const start = text.lastIndexOf("\n", index) + 1;
  const raw = lineAt(text, index);
  const lead = raw.match(/^[•\-*\s]+/)?.[0].length ?? 0;
  const line = raw.slice(lead).trimEnd();
  const rel = index - start - lead;
  const end = Math.min(line.length, rel + length);
  const marked = rel >= 0 && length > 0 ? `${line.slice(0, rel)}[${line.slice(rel, end)}]${line.slice(end)}` : line;
  if (marked.length <= 142) return marked;
  // Keep the bracketed span whole and in view.
  const from = Math.max(0, Math.min(rel - 50, marked.length - 142));
  const to = Math.max(from + 142, end + 2);
  return `${from > 0 ? "…" : ""}${marked.slice(from, to)}${to < marked.length ? "…" : ""}`;
}

/** Distinct, non-overlapping hits. */
function distinctCount(hits: { index: number; text: string }[]): number {
  let n = 0;
  let endAt = -1;
  for (const h of [...hits].sort((a, b) => a.index - b.index || b.text.length - a.text.length)) {
    if (h.index >= endAt) {
      n++;
      endAt = h.index + h.text.length;
    }
  }
  return n;
}

type Zone = "summary" | "recent role" | "older role" | "skills" | "education" | "other";

/** Map each line of the resume to a zone so we can apply positional (recency) weighting. */
function zoneMap(resume: ParsedResume): { zoneOfOffset: (i: number) => Zone } {
  const lineZone: Zone[] = resume.lines.map(() => "other");
  for (const s of resume.sections) {
    const z: Zone | null =
      s.key === "summary" ? "summary" : s.key === "skills" ? "skills" : s.key === "education" ? "education" : null;
    if (!z) continue;
    let count = 0;
    for (let i = s.startLine + 1; i < resume.lines.length && count < s.lines.length; i++) {
      if (resume.lines[i]) {
        lineZone[i] = z;
        count++;
      }
    }
  }
  // Roles: locate each role's bullets/header by text to tag recent (index 0-1) vs older.
  for (const role of resume.roles) {
    const z: Zone = role.index <= 1 ? "recent role" : "older role";
    const texts = new Set([...role.bullets, role.title, role.company].filter(Boolean));
    resume.lines.forEach((l, i) => {
      for (const t of texts) if (t && l.includes(t)) lineZone[i] = z;
    });
  }
  // Untagged summary paragraph at the top (no heading) still counts as summary.
  if (resume.summary) {
    const idx = resume.lines.findIndex((l) => l && resume.summary.startsWith(l.slice(0, 40)));
    if (idx >= 0 && lineZone[idx] === "other") lineZone[idx] = "summary";
  }
  const offsets: number[] = [];
  let off = 0;
  for (const l of resume.lines) {
    offsets.push(off);
    off += l.length + 1;
  }
  return {
    zoneOfOffset: (i: number) => {
      let lo = 0;
      let hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= i) lo = mid;
        else hi = mid - 1;
      }
      return lineZone[lo];
    },
  };
}

/** findTerm plus trailing-wildcard aliases from aliases.json. */
function termHits(text: string, v: string): { index: number; text: string }[] {
  return v.endsWith("*") ? wildcardHits(text, v) : findTerm(text, v);
}

function hitsFor(text: string, variants: string[]) {
  return variants.flatMap((v) =>
    termHits(text, v)
      // Short acronyms ("AI", "BI", "POC") only count in capitals, so "ai" in prose is ignored.
      .filter((h) => !(v.length <= 4 && v === v.toUpperCase() && /[A-Z]/.test(v)) || h.text.replace(/s$/, "") === h.text.replace(/s$/, "").toUpperCase())
      .map((h) => ({ ...h, variant: v })),
  );
}

/** Typo-tolerant single-token / short-phrase match on one line ("Kubernates", "Postgre SQL"). */
function fuzzyHit(lines: Tok[][], variant: string): { index: number; text: string } | null {
  const v = variant.toLowerCase();
  if (v.length < 5) return null;
  const n = v.split(/\s+/).length;
  for (const toks of lines) {
    for (let i = 0; i + n <= toks.length; i++) {
      const cand = toks.slice(i, i + n).map((x) => x.key).join(" ");
      if (Math.abs(cand.length - v.length) > 2) continue;
      if (jaroWinkler(cand, v) < 0.93 || trigramCosine(cand, v) < 0.55) continue;
      // Word by word too, so a different real word never passes as a typo ("product" ≠ "project").
      const vw = v.split(/\s+/);
      if (toks.slice(i, i + n).every((x, j) => x.key === vw[j] || jaroWinkler(x.key, vw[j]) >= 0.93)) return { index: toks[i].at, text: cand };
    }
  }
  return null;
}

/** Count distinct, non-overlapping occurrences of any variant. */
function countHits(text: string, variants: string[]): number {
  const spans = variants
    .flatMap((v) => termHits(text, v).map((h) => [h.index, h.index + h.text.length] as const))
    .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let n = 0;
  let end = -1;
  for (const [s, e] of spans) {
    if (s >= end) {
      n++;
      end = e;
    }
  }
  return n;
}

function initialsOf(s: string): string {
  return s
    .split(/[\s-]+/)
    .filter((w) => w && !/^(and|of|the|for|&)$/i.test(w))
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// Acronyms nobody spells out on a resume; suggesting the long form would read oddly.
const ACRONYM_ONLY = new Set(["SQL", "HTML", "CSS", "SAAS", "B2B", "B2C", "UX", "UI", "PHP", "JSON", "API", "APIS", "IOS", "SDK"]);

function titleWords(s: string): string {
  return s
    .split(" ")
    .map((w, i) => (i > 0 && /^(as|a|an|of|and|the|for|to|in|on)$/i.test(w) ? w.toLowerCase() : w.replace(/^[a-z]/, (c) => c.toUpperCase())))
    .join(" ");
}

/**
 * Acronym / expansion pair for a keyword, e.g. GCP + Google Cloud Platform. The keyword's own
 * term must be one side of the pair, so sibling aliases (SOA under Microservices) never pair.
 */
export function acronymPair(term: string, variants: string[]): { short: string; long: string } | null {
  const isShort = (v: string) => !v.includes(" ") && v.replace(/[^A-Za-z0-9]/g, "").length >= 2 && v.replace(/[^A-Za-z0-9]/g, "").length <= 6;
  const shortOf = (v: string) => (/[A-Z]/.test(v) ? v : v.toUpperCase());
  const candidates = isShort(term) ? variants.filter((v) => v.includes(" ")).map((l) => [term, l] as const) : variants.filter(isShort).map((s) => [s, term] as const);
  for (const [s, l] of candidates) {
    if (!l.includes(" ")) continue;
    const compact = s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (ACRONYM_ONLY.has(compact)) continue;
    if (initialsOf(l) === compact) return { short: shortOf(s), long: titleWords(l) };
  }
  return null;
}

export function matchKeywords(
  keywords: JDKeyword[],
  resume: ParsedResume,
  semanticEquivalents: Record<string, string> = {},
  jdText = "",
): KeywordMatch[] {
  const text = resume.text;
  const { zoneOfOffset } = zoneMap(resume);
  const lemmaLines = keyedLines(text, (t) => lemmas(t)[0]);
  const stemLines = keyedLines(text, (t) => stems(t)[0]);
  const rawLines = keyedLines(text, (t) => t.toLowerCase());

  return keywords.map((kw) => {
    const { def } = canonicalOf(kw.term);
    const isCanonicalDef = def && def.term.toLowerCase() === kw.term.toLowerCase();
    const synonyms = [...new Set([...(kw.aliases ?? []), ...(isCanonicalDef ? synonymsOf(def!) : []), ...fileAliasesOf(kw.term)])];
    const listed = new Set([kw.term, ...fileAliasesOf(kw.term)].map((x) => x.toLowerCase()));
    const soft = kw.category === "soft_skill";
    // Evidence rule: a match needs a head lemma of the keyword in its line ("time" for Time
    // Management), unless the phrase is the keyword itself or listed in the alias file. Soft
    // skills' taxonomy synonyms ("prioritize", "strategy") are associations, not aliases, so
    // they are checked; so is every semantic (re-worded / model-judged) match.
    const passes = (h: { index: number; variant: string }, strict: boolean) =>
      listed.has(h.variant.toLowerCase()) || !strict || hasHeadEvidence(kw.term, lineAt(text, h.index));

    type Hit = { index: number; text: string; variant: string };
    let matchType: MatchType = "none";
    let hits: Hit[] = [];
    const exact = hitsFor(text, [kw.term]);
    const alias = hitsFor(text, synonyms).filter((h) => passes(h, soft));
    if (exact.length) {
      matchType = "exact";
      hits = [...exact, ...alias];
    } else if (alias.length) {
      matchType = "alias";
      hits = alias;
    }
    if (matchType === "none") {
      // Same words, different inflection ("Manage stakeholders" vs "managed key stakeholders").
      const wf = [kw.term, ...synonyms].flatMap((v) => windowHits(lemmaLines, text, lemmas(v), 2).map((h) => ({ ...h, variant: v }))).filter((h) => passes(h, soft));
      if (wf.length) {
        matchType = "word-form";
        hits = wf;
      }
    }
    if (matchType === "none") {
      // A typo of the keyword itself ("Kubernates") is the keyword: no head check. A typo of a
      // soft skill's taxonomy synonym gets the same evidence rule as the synonym.
      const fz = [kw.term, ...synonyms]
        .map((v) => {
          const h = fuzzyHit(rawLines, v);
          return h && passes({ index: h.index, variant: v }, soft) ? h : null;
        })
        .find(Boolean);
      const sw = [kw.term, ...synonyms]
        .flatMap((v) => (stems(v).length >= 2 ? windowHits(stemLines, text, stems(v), 4).map((h) => ({ ...h, variant: v })) : []))
        .filter((h) => passes(h, true));
      const eq = semanticEquivalents[kw.term] ? hitsFor(text, [semanticEquivalents[kw.term]]).filter((h) => passes(h, true)) : [];
      if (fz) hits = [{ ...fz, variant: kw.term }];
      else if (sw.length) hits = sw; // derived forms / re-ordered phrase
      else if (eq.length) hits = eq;
      if (hits.length) matchType = "semantic";
    }
    if (matchType === "none") {
      // Only a sibling listed in the alias file's "related" groups (MySQL for PostgreSQL).
      const siblings = relatedSiblingsOf([kw.term, ...synonyms, ...(def ? [def.term] : [])]);
      const rel = hitsFor(text, siblings);
      if (rel.length) {
        matchType = "related";
        hits = rel;
      }
    }
    const matchedAs = hits[0]?.text ?? null;

    const locations = [...new Set(hits.map((h) => zoneOfOffset(h.index)))];
    const variants = [kw.term, ...synonyms];
    const jdCount = jdText ? Math.max(1, countHits(jdText, variants)) : 1;
    // Every occurrence that earned the credit counts (exact, alias, word-form, semantic). A
    // related sibling (REST for GraphQL) is a different skill, so it is not a mention.
    const resumeCount = matchType === "related" ? 0 : distinctCount(hits);
    let acronymTip: string | null = null;
    const pair = acronymPair(kw.term, synonyms);
    if (pair) {
      const hasShort = findTerm(text, pair.short).length > 0;
      const hasLong = findTerm(text, pair.long).length > 0;
      if (CREDIT[matchType] >= 0.8 && hasShort !== hasLong) acronymTip = `Write it both ways once: "${pair.long} (${pair.short})". Some ATS search only one form.`;
      else if (CREDIT[matchType] < 0.8) acronymTip = `When you add it, use both forms: "${pair.long} (${pair.short})".`;
    }
    return {
      term: kw.term,
      category: kw.category,
      priority: kw.priority,
      matchType,
      matchedAs,
      credit: CREDIT[matchType],
      jdCount,
      resumeCount,
      // Repeated in the JD = more important to the employer: 1x, 1.25x, 1.5x, capped at 1.75x.
      frequencyWeight: 1 + 0.25 * (Math.min(jdCount, 4) - 1),
      acronymTip,
      locations,
      recencyBoosted: locations.includes("summary") || locations.includes("recent role"),
      evidence: hits.length ? evidenceAt(text, hits[0].index, hits[0].text.length) || null : null,
    };
  });
}
