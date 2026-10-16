import { CASE_SENSITIVE, NEEDS_LIST_CONTEXT } from "./skills";

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp>();

/** Regex for a skill phrase with flexible spacing/hyphenation and an optional plural. */
function patternFor(variant: string): RegExp {
  const cached = patternCache.get(variant);
  if (cached) return cached;
  const body = variant
    .trim()
    .split(/([\s-]+)/)
    .map((part, i) => (i % 2 === 0 ? escapeRegex(part) : part.includes("-") ? "[\\s\\-]?" : "[\\s\\-]+"))
    .join("");
  const plural = /[a-z]$/i.test(variant) && variant.length > 3 ? "(?:e?s)?" : "";
  const re = new RegExp(`(?<![A-Za-z0-9+#])${body}${plural}(?![A-Za-z0-9+#])`, "gi");
  patternCache.set(variant, re);
  return re;
}

export interface Hit {
  index: number;
  text: string;
}

/** Find occurrences of a skill variant in free text, honoring case/context rules for ambiguous words. */
export function findTerm(text: string, variant: string): Hit[] {
  const v = variant.toLowerCase();
  const re = patternFor(variant);
  re.lastIndex = 0;
  const hits: Hit[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const found = m[0];
    if (CASE_SENSITIVE.has(v) && found === found.toLowerCase()) continue;
    if (NEEDS_LIST_CONTEXT.has(v) && !inListContext(text, m.index, found.length)) continue;
    // "Go-to-market" must not count as the Go language.
    if (v === "go" && /^-/.test(text.slice(m.index + found.length))) continue;
    hits.push({ index: m.index, text: found });
  }
  return hits;
}

function inListContext(text: string, start: number, len: number): boolean {
  const before = text.slice(Math.max(0, start - 3), start).trim();
  const after = text.slice(start + len, start + len + 14);
  return /[,/|(:•;]$/.test(before) || /^\s*[,/|);]/.test(after) || /^\s+(programming|language)/i.test(after);
}

const STOP = new Set(
  "a an the and or of for to in on at by with from as is are was were be been being this that these those it its our your their we you they i me my us will would should can could may might must have has had do does did not no but if then than so such into over under about across within per via using use used".split(
    " ",
  ),
);

/** Crude but stable stemmer: enough to align managed/managing/management, stakeholders/stakeholder. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  if (w.length <= 4) return w;
  // analysis / analyze / analyzed / analytics -> analy
  if (/(ysis|yses|yzed|yzing|yze|ysed|ysing|yse|ytics|ytical|ysts|yst)$/.test(w)) return w.replace(/(ysis|yses|yzed|yzing|yze|ysed|ysing|yse|ytics|ytical|ysts|yst)$/, "y");
  for (const suf of ["ements", "ement", "ations", "ation", "ings", "ing", "ers", "er", "ed", "es", "s", "ly"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

const LEMMA_IRREGULAR: Record<string, string> = {
  led: "lead", ran: "run", built: "build", wrote: "write", written: "write", drove: "drive", driven: "drive",
  made: "make", grew: "grow", grown: "grow", taught: "teach", bought: "buy", sold: "sell", held: "hold",
  took: "take", taken: "take", gave: "give", given: "give", chose: "choose", sent: "send", spent: "spend",
  saw: "see", seen: "see", did: "do", done: "do", won: "win", began: "begin", begun: "begin", met: "meet",
  analyses: "analysis", criteria: "criterion", data: "data", people: "person", men: "man", women: "woman",
};

/**
 * Inflectional lemma key: plural, -ed, -ing and third-person -s collapse to one key
 * ("managed"/"managing"/"manages" -> "manag", "planned"/"planning" -> "plan", "led" -> "lead").
 * Derivations ("management") are left alone; the stem-window matcher handles those at lower credit.
 */
export function lemma(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9+#/-]/g, "");
  if (LEMMA_IRREGULAR[w]) w = LEMMA_IRREGULAR[w];
  if (w.length <= 3 || /\d/.test(w)) return w;
  // British -ise / -isation spellings → -ize (prioritise = prioritize).
  if (w.length >= 7) w = w.replace(/is(e|ed|es|ing|ation|ations|er|ers)$/, "iz$1");
  // The -ization noun shares its verb's lemma: prioritization = prioritize = prioritizing.
  if (/izations?$/.test(w)) return w.replace(/izations?$/, "iz");
  if (/ies$/.test(w)) w = w.slice(0, -3) + "y";
  else if (/ied$/.test(w)) w = w.slice(0, -3) + "y";
  else if (/(ss|us|is|ics)$/.test(w)) return w;
  else if (/(ches|shes|xes|zes|sses)$/.test(w)) w = w.slice(0, -2);
  else if (/s$/.test(w)) w = w.slice(0, -1);
  else if (/ing$/.test(w) && w.length >= 6) w = w.slice(0, -3);
  else if (/ed$/.test(w) && w.length >= 5) w = w.slice(0, -2);
  if (/([bdfgklmnprtvz])\1$/.test(w)) w = w.slice(0, -1);
  if (/e$/.test(w) && w.length > 3) w = w.slice(0, -1);
  return w;
}

export function lemmas(text: string): string[] {
  return tokens(text).map(lemma);
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []).map((t) => t.replace(/\.$/, "")).filter((t) => t && !STOP.has(t));
}

export function stems(text: string): string[] {
  return tokens(text).map(stem);
}

/** Jaro-Winkler similarity, used for typo-tolerant matching of skill names. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const am = new Array<boolean>(la).fill(false);
  const bm = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Cosine similarity over character trigrams; a cheap lexical-semantic signal. */
export function trigramCosine(a: string, b: string): number {
  const grams = (s: string) => {
    const m = new Map<string, number>();
    const t = ` ${s.toLowerCase()} `;
    for (let i = 0; i < t.length - 2; i++) m.set(t.slice(i, i + 3), (m.get(t.slice(i, i + 3)) ?? 0) + 1);
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  A.forEach((v, k) => {
    na += v * v;
    dot += v * (B.get(k) ?? 0);
  });
  B.forEach((v) => (nb += v * v));
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const BULLET_RE = /^\s*(?:[•●▪◦‣·\-*–>]|o\s|\d{1,2}[.)])\s*/;
export function isBullet(line: string): boolean {
  return BULLET_RE.test(line) && line.replace(BULLET_RE, "").trim().length > 0;
}
export function stripBullet(line: string): string {
  return line.replace(BULLET_RE, "").trim();
}
