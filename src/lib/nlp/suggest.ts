import type { BulletAudit, BulletImprovement, KeywordMatch, KeywordPlacement, StructuredJD } from "../types";
import { SKILLS, canonicalOf, synonymsOf } from "./skills";
import { fileSynonymsOf } from "./matcher";
import { escapeRegex, findTerm, lemma, stems } from "./text";
import { STRONG_VERBS as STRONG_PAST, ingToPast, metricOptional, quantifyVague, startsWithStrongVerb, suggestVerb, weakPhraseOf } from "./verbs";

// Deterministic suggestion engine, used when no LLM is configured (and as a safety net when
// the LLM call fails). It never invents numbers: missing metrics become [placeholders].

const FAMILY_NEIGHBOURS: Record<string, string[]> = {
  containers: ["cloud", "cicd", "arch", "be-js", "be-py", "be-jvm", "infra", "iac"],
  cloud: ["containers", "serverless", "iac", "infra", "cicd", "arch"],
  serverless: ["cloud", "be-js", "be-py", "api"],
  iac: ["cloud", "containers", "cicd"],
  cicd: ["containers", "testing", "vcs", "iac"],
  api: ["be-js", "be-py", "be-jvm", "be-ruby", "arch", "fe-framework"],
  arch: ["api", "containers", "cloud", "streaming"],
  streaming: ["arch", "data-eng", "spark"],
  "fe-framework": ["lang-js", "web", "fe-state", "testing", "api"],
  testing: ["cicd", "fe-framework", "be-js", "be-py"],
  rdbms: ["sql", "be-js", "be-py", "be-jvm", "data-eng"],
  nosql: ["be-js", "be-py", "cache", "arch"],
  warehouse: ["sql", "data-eng", "bi", "spark", "orchestration"],
  "data-eng": ["sql", "warehouse", "spark", "orchestration", "lang-py"],
  ml: ["ml-fw", "lang-py", "py-data", "analytics"],
  analytics: ["sql", "bi", "product-analytics", "metrics", "lang-py"],
  bi: ["analytics", "sql", "warehouse"],
  "product-analytics": ["analytics", "metrics", "pm"],
  pm: ["research", "metrics", "agile", "pm-tools", "design"],
  research: ["pm", "design", "analytics"],
  agile: ["pm", "pm-tools"],
  metrics: ["pm", "analytics", "product-analytics"],
  obs: ["infra", "containers", "cloud"],
  security: ["api", "cloud", "infra"],
};

function familyOf(term: string): string | undefined {
  return canonicalOf(term).def?.family;
}

/** How naturally a missing keyword fits into a given bullet (0 = not at all). */
export function relatedness(keyword: string, bullet: string, jd: StructuredJD): number {
  const fam = familyOf(keyword);
  let score = 0;
  if (fam) {
    const neighbours = new Set([fam, ...(FAMILY_NEIGHBOURS[fam] ?? [])]);
    for (const s of SKILLS) {
      if (!s.family || !neighbours.has(s.family)) continue;
      if ([s.term, ...s.aliases].some((v) => findTerm(bullet, v).length)) score += s.family === fam ? 3 : 1.5;
    }
  }
  // Words that co-occur with the keyword in the JD's own responsibility/requirement lines.
  const jdCtx = jd.responsibilities.filter((r) => findTerm(r, keyword).length).join(" ");
  if (jdCtx) {
    const ctx = new Set(stems(jdCtx));
    score += stems(bullet).filter((s) => ctx.has(s)).length * 0.5;
  }
  return score;
}

/** Lower-case a sentence's first word, unless it's a name ("WordPress", "Salesforce", "Tableau"). */
function lowerFirst(s: string) {
  const first = s.match(/^[A-Za-z][\w-]*/)?.[0] ?? "";
  if (!/^[A-Z][a-z]/.test(s) || /[A-Z]/.test(first.slice(1)) || canonicalOf(first).def) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Remove weak openers and convert "-ing" leads, returning a phrase that follows a strong verb. */
function coreOf(bullet: string): { verb: string | null; rest: string } {
  let b = bullet.trim().replace(/\.$/, "");
  const weak = weakPhraseOf(b);
  if (weak) {
    b = b.slice(weak.length).trim().replace(/^(to|with|in|on)\s+/i, "");
    const m = b.match(/^([a-z]+)\s+(.*)$/i);
    if (m && /^(build|develop|design|launch|create|implement|improve|migrate|lead|manage|reduce|scale|automate|analyze|deliver|ship|deploy|optimize|test)$/i.test(m[1])) {
      const v = m[1].toLowerCase();
      // "Helped improve X" was shared work: "Collaborated to improve X", not "Improved X".
      if (SUPPORTING.has(weak)) return { verb: "Collaborated to", rest: `${v} ${m[2]}` };
      // "Was tasked to build X" → "Built X"
      const past = v === "build" ? "built" : v === "lead" ? "led" : v.endsWith("e") ? v + "d" : v === "ship" ? "shipped" : v + "ed";
      return { verb: past[0].toUpperCase() + past.slice(1), rest: m[2] };
    }
    const ing = b.match(/^([a-z]+ing)\s+(.*)$/i);
    if (ing) {
      const past = ingToPast(ing[1]);
      return { verb: past[0].toUpperCase() + past.slice(1), rest: ing[2] };
    }
    // "Supported / assisted / helped / participated in..." describe a contributing role.
    // Never upgrade them to "Led" or "Owned": keep the scope honest.
    if (SUPPORTING.has(weak)) {
      const withWhom = b.match(/^(the\s+[\w\s&/-]*?\b(?:team|group|lead|leads|manager|managers|engineers|department|staff)s?)\s+(?:on|with|in)\s+(.*)$/i);
      if (withWhom) return { verb: "Partnered with", rest: `${lowerFirst(withWhom[1])} on ${withWhom[2]}` };
      return { verb: "Collaborated on", rest: lowerFirst(b) };
    }
    return { verb: null, rest: lowerFirst(b) };
  }
  if (startsWithStrongVerb(b)) {
    const [v, ...r] = b.split(/\s+/);
    return { verb: v, rest: r.join(" ") };
  }
  return { verb: null, rest: lowerFirst(b) };
}

/** Weak openers that signal a supporting role rather than ownership. */
const SUPPORTING = new Set(["helped", "helped to", "assisted", "assisted with", "assisted in", "supported", "participated in", "involved in", "contributed to", "was part of", "part of", "worked with"]);

// Generic nouns a specific tool can qualify in place: "built dashboards" -> "built Tableau dashboards".
const GENERIC_NOUNS: Record<string, string[]> = {
  bi: ["dashboards", "dashboard", "reports", "reporting"],
  "product-analytics": ["dashboards", "funnels", "event tracking"],
  analytics: ["dashboards", "analysis", "reporting"],
  cloud: ["cloud", "infrastructure"],
  containers: ["containers", "container"],
  rdbms: ["database", "databases"],
  nosql: ["database", "databases"],
  warehouse: ["data warehouse", "warehouse"],
  testing: ["tests", "test suite", "test suites"],
  cicd: ["deployment pipeline", "deployment pipelines", "ci pipeline", "release pipeline"],
  "pm-tools": ["backlog", "backlogs", "tickets", "sprint board"],
  crm: ["customer records"],
  "fe-framework": ["frontend", "front-end"],
  ml: ["models", "model"],
  "ml-fw": ["models", "model"],
  obs: ["monitoring", "alerting", "alerts"],
  iac: ["infrastructure"],
  "data-eng": ["pipelines", "pipeline", "etl"],
  design: ["mockups", "prototypes", "wireframes"],
  vcs: ["repository", "repositories", "repo"],
};

/** Tools and certifications are capitalised as written; concepts are lower-cased in a sentence. */
function isToolLike(kw: string): boolean {
  const def = canonicalOf(kw).def;
  return def ? def.category === "tool" || def.category === "certification" : /[A-Z].*[A-Z]|\.\w|\d/.test(kw);
}

/**
 * Put a missing keyword into a bullet by substituting words, never by appending a clause:
 *  1. a phrase that means the same thing ("stakeholder engagement" -> "stakeholder management");
 *  2. the keyword's head noun gains its qualifier ("built pipelines" -> "built data pipelines");
 *  3. a generic noun is qualified by the tool ("built dashboards" -> "built Tableau dashboards").
 * Returns null when no honest substitution exists; the caller then suggests the Skills section.
 */
export function substituteKeyword(rest: string, kw: string): string | null {
  if (findTerm(rest, kw).length) return null;
  const def = canonicalOf(kw).def;
  const lower = !isToolLike(kw) && /^[A-Z][a-z]+(?:[\s-][A-Za-z][a-z]+)*$/.test(kw);
  const display = lower ? kw.toLowerCase() : kw;
  // 1. Same-meaning phrase.
  const same = [...fileSynonymsOf(kw), ...(def ? synonymsOf(def) : [])].filter((a) => a.includes(" ") || a.length > 4);
  for (const a of same) {
    const h = findTerm(rest, a)[0];
    if (h) return rest.slice(0, h.index) + display + rest.slice(h.index + h.text.length);
  }
  // 2. Head noun: last word of a 2-3 word keyword, present on its own; keep its number.
  const words = display.split(/\s+/);
  if (words.length >= 2 && words.length <= 3) {
    const headWord = words[words.length - 1];
    const m = [...rest.matchAll(/[A-Za-z][A-Za-z-]*/g)].find((t) => lemma(t[0]) === lemma(headWord));
    if (m && m.index !== undefined) {
      const before = rest.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
      const quals = words.slice(0, -1);
      if (!quals.some((q) => before.includes(q.toLowerCase()))) {
        const at = m.index;
        return `${rest.slice(0, at)}${quals.join(" ")} ${m[0]}${rest.slice(at + m[0].length)}`;
      }
    }
  }
  // 3. Generic noun qualified by the tool.
  if (def?.family && isToolLike(kw)) {
    for (const g of GENERIC_NOUNS[def.family] ?? []) {
      const re = new RegExp(`(?<![A-Za-z])${escapeRegex(g)}(?![A-Za-z])`, "i");
      const m = rest.match(re);
      if (m && m.index !== undefined) return `${rest.slice(0, m.index)}${kw} ${m[0]}${rest.slice(m.index + m[0].length)}`;
    }
  }
  return null;
}

/**
 * Fix only the opener of a weak bullet ("Responsible for X" → "Managed X", "Helped build X" →
 * "Built X", "Managing X" → "Managed X"), keeping every fact and the original scope. Returns null
 * when the bullet already opens well or can't be fixed safely.
 */
export function strengthenOpener(bullet: string): string | null {
  const text = bullet.trim();
  if (startsWithStrongVerb(text)) return null;
  const weak = weakPhraseOf(text);
  const first = text.split(/\s+/)[0] ?? "";
  // Present-tense or gerund openers in a bullet: "Manage X" / "Managing X" → "Managed X".
  if (!weak) {
    const past = /ing$/i.test(first) ? ingToPast(first) : /^[a-z]+$/i.test(first) ? `${first.toLowerCase()}${/e$/i.test(first) ? "d" : "ed"}` : "";
    if (past && STRONG_PAST.has(past)) return `${past[0].toUpperCase()}${past.slice(1)} ${text.slice(first.length).trim()}`;
    return null;
  }
  const { verb, rest } = coreOf(text);
  const owned = ["responsible for", "in charge of", "handled", "tasked with", "duties included"];
  // "Worked on / used / utilized" say nothing about scope, so a content-based verb fits ("Ran A/B tests").
  const neutral = ["worked on", "used", "utilized", "did"];
  const v = verb ?? (owned.includes(weak) ? "Managed" : neutral.includes(weak) ? suggestVerb(rest) : null);
  if (!v || !rest) return null;
  const end = /[.!]$/.test(text) ? "." : "";
  return `${v} ${rest.replace(/\.$/, "")}${end}`;
}

/**
 * Heuristic rewrites made only of word substitutions, never appended clauses:
 *  1. the opener swapped for a strong, honest verb;
 *  2. a missing keyword substituted in (see substituteKeyword);
 *  3. a vague quantity word swapped for an [N] placeholder ("several" → "[N]"), only when the
 *     bullet has no number yet and a metric makes sense for it (not alignment/risk work).
 * Returns 1-3 distinct options (the original is never returned as an option unless nothing
 * can be improved by substitution).
 */
export function heuristicRewrites(bullet: string, missing: string[], jd: StructuredJD): string[] {
  const { verb, rest } = coreOf(bullet);
  const v = verb ?? suggestVerb(bullet);
  const end = (s: string) => `${s.replace(/[.,;:\s]+$/, "")}.`;
  const opener = end(`${v} ${rest}`);
  const withKw =
    missing
      .map((k) => ({ s: relatedness(k, bullet, jd), sub: substituteKeyword(rest, k) }))
      .filter((x) => x.sub && x.s > 0)
      .sort((a, b) => b.s - a.s)[0]?.sub ?? null;
  const opts = [opener, withKw ? end(`${v} ${withKw}`) : null, quantifyVague(withKw ? end(`${v} ${withKw}`) : opener)];
  const original = end(bullet.trim());
  const clean = [...new Set(opts.filter((o): o is string => !!o).map((o) => o.replace(/\s+/g, " ").trim()))];
  const changed = clean.filter((o) => o !== original);
  return changed.length ? changed : [original];
}

export function heuristicPlacements(
  matches: KeywordMatch[],
  bullets: string[],
  jd: StructuredJD,
): KeywordPlacement[] {
  const missing = matches.filter((m) => m.credit < 0.8 && m.category !== "soft_skill");
  const ordered = [...missing.filter((m) => m.priority === "must"), ...missing.filter((m) => m.priority === "nice")].slice(0, 10);
  // Each bullet takes at most one new keyword, so suggestions never stack into keyword stuffing.
  const used = new Set<string>();
  return ordered.map((m) => {
    const ranked = bullets
      .filter((b) => !used.has(b))
      .map((b) => ({ b, s: relatedness(m.term, b, jd) }))
      .sort((a, b) => b.s - a.s);
    // Best related bullet where the keyword can replace existing words (no added clauses).
    const best = ranked
      .filter((x) => x.s >= 1.5)
      .map((x) => ({ ...x, sub: substituteKeyword(x.b.replace(/\.\s*$/, ""), m.term) }))
      .find((x) => x.sub);
    if (best?.sub) {
      used.add(best.b);
      return {
        keyword: m.term,
        priority: m.priority,
        targetBullet: best.b,
        section: "Experience",
        suggestion: `${best.sub}${/\.\s*$/.test(best.b) ? "." : ""}`,
      };
    }
    return {
      keyword: m.term,
      priority: m.priority,
      targetBullet: null,
      section: "Skills",
      suggestion: `If you have real ${m.term} experience, list it under Skills and back it up with one bullet in your most recent role that shows what you built or improved with it.`,
    };
  });
}

export function heuristicImprovements(audit: BulletAudit[], missing: string[], jd: StructuredJD): BulletImprovement[] {
  return [...audit]
    .filter((a) => a.score < 90)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((a) => {
      // The most complete substitution-only option (keyword and/or [N]), else the opener fix.
      const opts = heuristicRewrites(a.text, missing, jd);
      return { a, suggested: opts[opts.length - 1] };
    })
    .filter(({ a, suggested }) => suggested && suggested.replace(/\.$/, "") !== a.text.trim().replace(/\.$/, ""))
    .map(({ a, suggested }) => ({
      original: a.text,
      suggested,
      reason: [
        a.weakPhrase ? `weak opener "${a.weakPhrase}"` : !a.strongVerb ? "no strong action verb" : null,
        a.hasMetric ? null : a.metricOptional || metricOptional(a.text) ? "metric optional (alignment/risk work)" : "no quantified result: add one in your own words if you have it",
      ]
        .filter(Boolean)
        .join(", "),
    }));
}
