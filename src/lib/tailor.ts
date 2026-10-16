import type { AnalysisResult } from "./types";
import { isBullet, stripBullet, escapeRegex } from "./nlp/text";
import { quantifyVague } from "./nlp/verbs";
import { strengthenOpener } from "./nlp/suggest";
import { findDateRanges } from "./nlp/dates";

// Auto-tailoring: turns an analysis into a list of concrete, reviewable edits and applies them.
// Safe fixes (headings, dates, bullet openers, spelling, grammar, filler, acronyms) run by
// default. Missing keywords are added only for skills the user confirms they really have, so
// the tailored resume never claims experience it shouldn't. No edit may add a line.

export type ChangeKind = "heading" | "date" | "bullet" | "spelling" | "grammar" | "filler" | "acronym" | "keyword" | "metric";

export interface TailorChange {
  id: string;
  kind: ChangeKind;
  label: string;
  before: string;
  after: string;
  /** Exact text to replace (first occurrence), or a regex source when `regex` is set. */
  find: string;
  replace: string;
  regex?: { flags: string };
  /** Something the user must still check (e.g. a placeholder to fill in). */
  note?: string;
  enabled: boolean;
  /** Why the change can't be applied (e.g. it would add a line to the layout). */
  blocked?: string;
}

export interface TailorOptions {
  headings: boolean;
  dates: boolean;
  bullets: boolean;
  spelling: boolean;
  grammar: boolean;
  filler: boolean;
  acronyms: boolean;
  /** Swap vague quantity words ("several") for [N] placeholders; never appends anything. */
  metricPlaceholders: boolean;
  /** Missing keywords the user confirmed they really have. */
  addKeywords: string[];
  /** Also weave confirmed keywords into their best-matching bullet (not just Skills). */
  weaveKeywords: boolean;
}

export const DEFAULT_OPTIONS: TailorOptions = {
  headings: true,
  dates: true,
  bullets: true,
  spelling: true,
  grammar: true,
  filler: true,
  acronyms: true,
  metricPlaceholders: false,
  addKeywords: [],
  weaveKeywords: false,
};

const STANDARD_HEADING: Record<string, string> = {
  summary: "Professional Summary",
  experience: "Work Experience",
  education: "Education",
  skills: "Skills",
  contact: "Contact",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTH = /\b(January|February|March|April|June|July|August|September|Sept|October|November|December)\b/g;

/** Normalize the dates on one line to "Mon YYYY – Mon YYYY". Returns null when nothing changes. */
export function normalizeDateLine(line: string): { text: string; season: boolean } | null {
  // Only lines that really carry dates (ranges, MM/YYYY, seasons); phone numbers stay untouched.
  if (!findDateRanges(line).length && !/\b(0?[1-9]|1[0-2])\/\d{4}\b|\b(spring|summer|fall|autumn|winter)\s+\d{4}\b/i.test(line)) return null;
  let s = line;
  let season = false;
  s = s.replace(/\b(0?[1-9]|1[0-2])\/(\d{4})\b/g, (_, m, y) => `${MONTHS[+m - 1]} ${y}`);
  s = s.replace(/\b(\d{4})-(0[1-9]|1[0-2])\b(?!\d)/g, (_, y, m) => `${MONTHS[+m - 1]} ${y}`);
  s = s.replace(/\b(Spring|Summer|Fall|Autumn|Winter)\s+(\d{4})\b/gi, (_, __, y) => {
    season = true;
    return `[Month] ${y}`;
  });
  s = s.replace(FULL_MONTH, (m) => (m.startsWith("Sept") ? "Sep" : m.slice(0, 3)));
  // One separator style between dates: "Jan 2020 – Present".
  s = s.replace(/((?:[A-Z][a-z]{2}|\[Month\])\s+\d{4}|\b\d{4})\s*(?:-|–|—|to)\s*((?:[A-Z][a-z]{2}\s+)?\d{4}\b|Present|Current|present|current|Now|now)/g, (_, a, b) => `${a} – ${/^(present|current|now)$/i.test(b) ? "Present" : b}`);
  return s === line ? null : { text: s, season };
}

function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (/^[A-Z]/.test(original)) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/**
 * A *pessimistic* number of average-width characters that always fit on one printed line of the
 * uploaded resume (real lines usually hold more). Word files: from page width, margins and body
 * font size with a wide-character assumption. PDFs: from the real line lengths (each PDF text line
 * is a printed line). Plain text has no layout.
 */
export function lineCapacity(r: AnalysisResult): number {
  const L = r.resume.layout;
  // Tables, columns and text boxes make line width unknowable (a cell may be an inch wide), so
  // edits there may never be wider than the original: capacity 0 disables the "fits anyway" path.
  if (r.resume.fileType !== "txt" && (L.hasTables || L.columns > 1 || L.hasTextBoxes)) return 0;
  if (r.resume.fileType === "docx" && L.page?.margins && L.typography?.bodySize) {
    const usable = L.page.width - L.page.margins.left - L.page.margins.right - 36; // bullet indent + slack
    return Math.max(35, Math.floor(usable / (L.typography.bodySize * 0.55)));
  }
  if (r.resume.fileType === "pdf") {
    const lens = r.resume.text
      .split("\n")
      .map((l) => textWidth(l.trim()))
      .filter((n) => n > 25)
      .sort((a, b) => a - b);
    if (lens.length >= 5) return Math.floor(lens[Math.floor(lens.length * 0.75)]);
    return 60;
  }
  // Plain text has no page layout: the only rule is "no new line breaks".
  return Infinity;
}

/**
 * Approximate printed width in "average characters": narrow letters (i, l, t, punctuation)
 * count less, wide ones (m, w, capitals, digits) more. Good enough to compare two versions of
 * the same line in the same font.
 */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[ilj.,;:'!|()[\]\s]/.test(ch)) w += 0.5;
    else if (/[ftr\-–]/.test(ch)) w += 0.7;
    else if (/[mwMW@%]/.test(ch)) w += 1.5;
    else if (/[A-Z0-9#&$]/.test(ch)) w += 1.2;
    else w += 1;
  }
  return w;
}

/** Printed lines a piece of text occupies, at worst, for a given (pessimistic) capacity. */
export function visualLines(text: string, cap: number): number {
  return Math.max(1, Math.ceil(textWidth(text.trim()) / cap));
}

/**
 * Safe-by-construction line budget: an edit is allowed only if the new text is no wider than the
 * old (so it can't wrap further), or if it's short enough to fit on one line even at the
 * pessimistic capacity. It never relies on guessing where the original wrapped.
 */
export function fitsLine(before: string, after: string, cap: number): boolean {
  if (after.includes("\n")) return false;
  return textWidth(after.trim()) <= textWidth(before.trim()) || textWidth(after.trim()) <= cap;
}

export const WOULD_ADD_LINE = "Not applied: it would push this text onto an extra line in your layout.";

/** Plan every edit for a resume. Pure: nothing is applied until applyChanges(). */
export function planTailoring(r: AnalysisResult, opts: TailorOptions = DEFAULT_OPTIONS): TailorChange[] {
  const text = r.resume.text;
  const lines = text.split("\n");
  const changes: TailorChange[] = [];
  const cap = lineCapacity(r);
  // An edit may change words but never the number of printed lines the text takes.
  const fits = (before: string, after: string) => fitsLine(before, after, cap);
  let n = 0;
  // Running text of every line as planned changes accumulate, so two edits on the same line
  // can't together push it past its printed length.
  const cur = [...lines];
  const simulate = (c: Omit<TailorChange, "id" | "enabled">): { idx: number; text: string }[] | null => {
    if (c.regex) {
      const global = c.regex.flags.includes("g");
      const out: { idx: number; text: string }[] = [];
      for (let i = 0; i < cur.length; i++) {
        if (!new RegExp(c.find, c.regex.flags.replace("g", "")).test(cur[i])) continue;
        out.push({ idx: i, text: cur[i].replace(new RegExp(c.find, c.regex.flags), c.replace) });
        if (!global) break;
      }
      return out.length ? out : null;
    }
    const i = cur.findIndex((l) => l.includes(c.find));
    return i < 0 ? null : [{ idx: i, text: cur[i].replace(c.find, c.replace) }];
  };
  const add = (c: Omit<TailorChange, "id" | "enabled">, ..._legacy: unknown[]) => {
    const sim = simulate(c);
    const blocked = sim?.some((s) => !fits(lines[s.idx], s.text)) ? WOULD_ADD_LINE : undefined;
    if (sim && !blocked) for (const s of sim) cur[s.idx] = s.text;
    changes.push({ ...c, id: `${c.kind}-${n++}`, enabled: !blocked, blocked });
  };

  // ---- Headings ----
  if (opts.headings) {
    for (const s of r.resume.sections) {
      const std = STANDARD_HEADING[s.key];
      if (!std || s.standard || s.heading.startsWith("(")) continue;
      const line = lines.find((l) => l.trim().replace(/:$/, "") === s.heading);
      if (!line) continue;
      const after = line.trim() === line.trim().toUpperCase() ? std.toUpperCase() : std;
      add({ kind: "heading", label: `Rename "${s.heading}" to the standard heading "${after}"`, before: line.trim(), after, find: line, replace: line.replace(line.trim(), after) }, line, after);
    }
  }

  // ---- Dates ----
  if (opts.dates) {
    for (const line of lines) {
      const fixed = normalizeDateLine(line);
      if (!fixed) continue;
      add(
        {
          kind: "date",
          label: "Use one date format (Mon YYYY – Mon YYYY)",
          before: line.trim(),
          after: fixed.text.trim(),
          find: line,
          replace: fixed.text,
          note: fixed.season ? "Replace [Month] with the real start month." : undefined,
        },
        line,
        fixed.text,
      );
    }
  }

  // ---- Bullets: honest opener fixes, optional metric placeholders ----
  const bulletEdits = new Map<string, string>();
  if (opts.bullets || opts.metricPlaceholders) {
    for (const b of r.bulletAudit) {
      let next = opts.bullets ? (strengthenOpener(b.text) ?? b.text) : b.text;
      let note: string | undefined;
      // A placeholder only replaces a vague word ("several clients" → "[N] clients"); nothing is
      // appended. Never on a bullet that already has a number, or on alignment/risk work.
      const withMetric = opts.metricPlaceholders ? quantifyVague(next) : null;
      if (withMetric && fits(b.text, withMetric)) {
        next = withMetric;
        note = "Replace [N] with the real count, or put the original word back.";
      }
      if (next === b.text) continue;
      if (fits(b.text, next)) bulletEdits.set(b.text, next);
      add(
        {
          kind: next !== b.text && opts.bullets && strengthenOpener(b.text) ? "bullet" : "metric",
          label: b.weakPhrase ? `Replace weak opener "${b.weakPhrase}"` : strengthenOpener(b.text) ? "Lead with a past-tense action verb" : "Add a result placeholder",
          before: b.text,
          after: next,
          find: b.text,
          replace: next,
          note,
        },
        b.text,
        next,
      );
    }
  }

  // ---- Confirmed keywords: Skills section, optionally the best-matching bullet ----
  const confirmed = opts.addKeywords.filter((k) => !new RegExp(`(?<![A-Za-z0-9])${escapeRegex(k)}(?![A-Za-z0-9])`, "i").test(text));
  if (confirmed.length) {
    // Append to existing Skills lines only, and only while each line keeps its printed length.
    // No new bullet, line or section is ever created.
    const skills = r.resume.sections.find((s) => s.key === "skills");
    const headIdx = skills ? lines.findIndex((l) => l.trim().replace(/:$/, "") === skills.heading) : -1;
    const skillLines: string[] = [];
    if (headIdx >= 0)
      for (let i = headIdx + 1; i < lines.length; i++) {
        if (!lines[i].trim()) {
          if (skillLines.length) break;
          continue;
        }
        if (skills && r.resume.sections.some((s) => s.heading === lines[i].trim().replace(/:$/, "") && s !== skills)) break;
        // Table rows ("A | B | C") are separate cells in the file; appending there can't be matched in place.
        if (!(r.resume.fileType === "docx" && / \| /.test(lines[i]))) skillLines.push(lines[i]);
      }
    let left = [...confirmed];
    for (const line of skillLines) {
      if (!left.length) break;
      const taken: string[] = [];
      let after = line;
      for (const k of left) {
        const candidate = `${after.replace(/[\s,;.]+$/, "")}, ${k}`;
        if (fits(line, candidate)) {
          after = candidate;
          taken.push(k);
        }
      }
      if (!taken.length) continue;
      left = left.filter((k) => !taken.includes(k));
      add({ kind: "keyword", label: `Add to Skills: ${taken.join(", ")}`, before: line.trim(), after: after.trim(), find: line, replace: after }, line, after);
    }
    if (left.length)
      changes.push({
        id: `keyword-${n++}`,
        kind: "keyword",
        label: `No room for ${left.join(", ")}`,
        before: skillLines.length ? "Skills lines are full" : "No Skills section found",
        after: left.join(", "),
        find: "",
        replace: "",
        enabled: false,
        blocked: skillLines.length
          ? "Not applied: your Skills lines are full. Swap out a less relevant skill for these by hand."
          : "Not applied: there's no Skills line to add them to without adding lines.",
      });
    if (opts.weaveKeywords) {
      for (const p of r.keywordPlacements) {
        if (!p.targetBullet || !confirmed.includes(p.keyword) || bulletEdits.has(p.targetBullet)) continue;
        add({ kind: "keyword", label: `Mention ${p.keyword} where you used it`, before: p.targetBullet, after: p.suggestion, find: p.targetBullet, replace: p.suggestion, note: "Check the wording is true to what you did." }, p.targetBullet, p.suggestion);
      }
    }
  }

  // ---- Acronyms: write both forms once ----
  if (opts.acronyms) {
    for (const m of r.keywords.details) {
      if (m.credit < 0.8 || !m.acronymTip) continue;
      const pair = m.acronymTip.match(/"(.+) \(([^)]+)\)"/);
      if (!pair) continue;
      const [, long, short] = pair;
      const hasLong = new RegExp(`\\b${escapeRegex(long)}\\b`, "i").test(text);
      const shortRe = `(?<![A-Za-z0-9(])${escapeRegex(short)}(?![A-Za-z0-9])`;
      const hasShort = new RegExp(shortRe).test(text);
      const spec =
        hasShort && !hasLong
          ? { label: `Spell out ${short} once`, before: short, find: shortRe, flags: "" }
          : hasLong && !hasShort
            ? { label: `Add the acronym ${short}`, before: long, find: `\\b${escapeRegex(long)}\\b`, flags: "i" }
            : null;
      if (!spec) continue;
      // Budget against the line holding the first occurrence.
      const re = new RegExp(spec.find, spec.flags);
      const line = lines.find((l) => re.test(l)) ?? "";
      add({ kind: "acronym", label: spec.label, before: spec.before, after: `${long} (${short})`, find: spec.find, replace: `${long} (${short})`, regex: { flags: spec.flags } }, line, line.replace(re, `${long} (${short})`));
    }
  }

  // ---- Filler ----
  if (opts.filler) {
    if (/\bin order to\b/i.test(text)) add({ kind: "filler", label: 'Shorten "in order to" to "to"', before: "in order to", after: "to", find: "\\bin order to\\b", replace: "to", regex: { flags: "gi" } });
    if (/\butili[sz]ed\b/i.test(text)) add({ kind: "filler", label: 'Use "used" instead of "utilized"', before: "utilized", after: "used", find: "\\butili[sz]ed\\b", replace: "used", regex: { flags: "gi" } });
  }

  // ---- Spelling & mechanical grammar (word-level, applied last) ----
  for (const i of r.writing.issues) {
    if (i.kind === "spelling" && opts.spelling) {
      const sug = i.suggestions[0];
      if (!sug || i.text.length < 5 || editDistance(i.text.toLowerCase(), sug.toLowerCase()) > 2) continue;
      add({ kind: "spelling", label: `Fix spelling: "${i.text}" → "${sug}"`, before: i.text, after: sug, find: `\\b${escapeRegex(i.text)}\\b`, replace: preserveCase(i.text, sug), regex: { flags: "g" } });
    }
    if (i.kind === "grammar" && opts.grammar) {
      const dup = i.text.match(/^(\w+)\s+\1$/i);
      if (dup) add({ kind: "grammar", label: `Remove repeated word "${dup[1]}"`, before: i.text, after: dup[1], find: `\\b${escapeRegex(dup[1])}\\s+${escapeRegex(dup[1])}\\b`, replace: dup[1], regex: { flags: "gi" } });
      else if (/^an? \w+/i.test(i.text) && i.suggestions[0]) add({ kind: "grammar", label: `Fix article: "${i.text}" → "${i.suggestions[0]}"`, before: i.text, after: i.suggestions[0], find: `\\b${escapeRegex(i.text)}\\b`, replace: i.suggestions[0], regex: { flags: "g" } });
      else if (i.text === "double space") add({ kind: "grammar", label: "Remove double spaces inside lines", before: "two spaces", after: "one space", find: "(\\S) {2}(\\S)", replace: "$1 $2", regex: { flags: "g" } });
    }
  }
  return changes;
}

/** Apply enabled changes in planning order. Changes whose target text is gone are reported as skipped. */
export function applyChanges(text: string, changes: TailorChange[]): { text: string; applied: string[]; skipped: string[] } {
  let out = text;
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const c of changes) {
    if (!c.enabled || c.blocked) continue;
    if (c.regex) {
      const re = new RegExp(c.find, c.regex.flags);
      if (!re.test(out)) {
        skipped.push(c.id);
        continue;
      }
      re.lastIndex = 0;
      out = out.replace(re, c.replace);
    } else {
      // Bullets are matched without their glyph so "• Text" and "- Text" both work.
      const idx = out.indexOf(c.find);
      if (idx < 0) {
        skipped.push(c.id);
        continue;
      }
      out = out.slice(0, idx) + c.replace + out.slice(idx + c.find.length);
    }
    applied.push(c.id);
  }
  return { text: out, applied, skipped };
}

/** Every safe automatic fix, no placeholders, no keywords: the base for target-score plans. */
export const SAFE_OPTIONS: TailorOptions = { ...DEFAULT_OPTIONS, metricPlaceholders: false, addKeywords: [], weaveKeywords: false };

/** Stable identity for a change across re-plans (ids are positional). */
export function changeKey(c: Pick<TailorChange, "kind" | "find" | "replace">): string {
  return `${c.kind}|${c.find}|${c.replace}`;
}

/** The plan for a chosen set of safe changes plus confirmed keywords. */
export function selectionPlan(base: AnalysisResult, safeKeys: Set<string>, keywords: string[]): TailorChange[] {
  return planTailoring(base, { ...SAFE_OPTIONS, addKeywords: keywords }).map((c) =>
    c.kind === "keyword" ? c : { ...c, enabled: !c.blocked && safeKeys.has(changeKey(c)) },
  );
}

/** Things auto-tailoring deliberately doesn't do, for the user to handle. */
export function manualTodos(r: AnalysisResult, opts: TailorOptions): string[] {
  const todos: string[] = [];
  for (const k of r.knockouts?.checks ?? [])
    if (k.status === "fail" || k.status === "risk") todos.push(`Knockout (${k.label}): ${k.advice}`);
  const missing = [...r.keywords.missingMustHave].filter((k) => !opts.addKeywords.includes(k));
  if (missing.length) todos.push(`Missing must-have keywords not added: ${missing.join(", ")}. Add any you genuinely have (tick them above) and leave the rest out.`);
  const c = r.resume.contact;
  if (!c.email || !c.phone) todos.push("Add your email and phone as plain text at the top.");
  if (!c.linkedin) todos.push("Add your LinkedIn URL (written out, e.g. linkedin.com/in/your-name).");
  if (!c.location) todos.push('Add your location ("City, State/Country").');
  if (!r.resume.sections.some((s) => s.key === "summary") && !r.resume.sections.some((s) => s.key === "other" && /summary|profile/i.test(s.heading)))
    todos.push(`Write a 2–3 line Professional Summary${r.jd.targetTitle ? ` that names "${r.jd.targetTitle}"` : ""} and your top matching skills.`);
  const L = r.resume.layout;
  if (L.columns > 1 || L.hasTables || L.hasTextBoxes || L.headerFooterText)
    todos.push("Your original file's layout (columns, tables, text boxes or header contact) is an ATS risk. Use Export → Download PDF here for a clean single-column version.");
  return todos;
}

/** Placeholders left in a tailored resume that the user must fill in. */
export function placeholders(text: string): string[] {
  return [...new Set(text.match(/\[[^\]\n]{1,60}\]/g) ?? [])];
}

export { isBullet, stripBullet };
