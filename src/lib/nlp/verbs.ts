// Action-verb lexicon for bullet impact scoring.

export const STRONG_VERBS = new Set(
  `accelerated achieved acquired activated adapted administered advanced advised advocated aligned allocated analyzed
  analysed architected arranged assembled assessed attained audited authored automated balanced benchmarked boosted
  briefed budgeted built calculated captured catalyzed centralized championed clarified coached co-founded collaborated
  combined commissioned completed composed conceived conceptualized condensed conducted consolidated constructed consulted
  contracted converted coordinated corrected crafted created cultivated curated cut debugged decreased defined delegated
  delivered deployed designed detected developed devised diagnosed digitized directed discovered doubled drafted drove
  eliminated enabled engineered enhanced established evaluated exceeded executed expanded expedited experimented facilitated
  finalized fixed forecasted formalized formulated fostered founded generated grew guided halved headed hired identified
  implemented improved increased influenced initiated innovated inspected instituted instrumented integrated interviewed
  introduced invented investigated launched led leveraged liaised lowered maintained managed mapped marketed maximized
  measured mentored merged migrated minimized mobilized modeled modelled modernized monitored motivated negotiated
  onboarded operated optimized orchestrated organized originated outperformed overhauled oversaw owned partnered pioneered
  piloted planned presented prioritized processed produced programmed projected promoted proposed prototyped provisioned
  published raised rebuilt recommended reconciled recruited redesigned reduced refactored refined reengineered remediated
  reorganized replaced reported researched resolved restored restructured revamped reversed reviewed revitalized saved
  scaled scoped secured segmented shaped shipped simplified slashed solved spearheaded specified sped stabilized
  standardized steered streamlined strengthened structured supervised surpassed synthesized systematized tested tracked
  trained transformed translated tripled troubleshot tuned unified unlocked upgraded validated verified visualized won
  wrote`
    .split(/\s+/)
    .filter(Boolean),
);

export const WEAK_PHRASES = [
  "responsible for",
  "worked on",
  "worked with",
  "helped",
  "helped to",
  "assisted",
  "assisted with",
  "assisted in",
  "participated in",
  "involved in",
  "tasked with",
  "duties included",
  "in charge of",
  "handled",
  "did",
  "was part of",
  "part of",
  "contributed to",
  "supported",
  "used",
  "utilized",
];

export function weakPhraseOf(bullet: string): string | null {
  const b = bullet.toLowerCase().trim();
  const hits = WEAK_PHRASES.filter((p) => b.startsWith(p + " ") || b === p);
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function firstWord(bullet: string): string {
  return (bullet.trim().match(/^[A-Za-z-]+/)?.[0] ?? "").toLowerCase();
}

export function startsWithStrongVerb(bullet: string): boolean {
  return STRONG_VERBS.has(firstWord(bullet));
}

// Percentages, currency, multipliers, counts of people/things, time saved, rankings.
const METRIC_RES = [
  /\d+(\.\d+)?\s?%/,
  /[$€£₹¥]\s?\d/,
  /\b\d+(\.\d+)?\s?(k|m|mm|b|bn|million|billion|thousand|lakh|crore|cr)\b/i,
  /\b\d+(\.\d+)?\s?x\b/i,
  /\b\d+\+?\s+(users|customers|clients|engineers|people|members|reports|stakeholders|countries|markets|teams|services|microservices|apis|projects|products|features|stores|sites|accounts|hours|days|weeks|months|requests|transactions|deployments|releases|leads|deals|sku|skus|partners|vendors|students|patients|regions|languages|integrations|dashboards|models|pipelines)/i,
  /\b(team|group|squad|org) of \d+/i,
  /\b(top|rank(ed)?)\s?\d+/i,
  /\b\d{2,}(,\d{3})+\b/,
  /\b(doubled|tripled|halved|quadrupled)\b/i,
  // Durations: "from 1 hour to 5 minutes", "in 3 weeks", "saved 10 hours".
  /\b\d+(\.\d+)?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|quarters?)\b/i,
  // Team sizes written as compounds: "4-member team", "12-person squad".
  /\b\d+[- ](member|person|people|strong|engineer|analyst)s?\b/i,
  // Before/after comparisons: "from 4.1s to 1.6s", "from 52% to 81%", "from $2M to $3M".
  /\bfrom\s+[$€£₹]?\d[\d.,]*\s*\S{0,12}\s+to\s+[$€£₹]?\d/i,
];

export function hasMetric(bullet: string): boolean {
  return METRIC_RES.some((re) => re.test(bullet));
}

/**
 * Alignment, coordination, escalation, risk, governance and compliance work rarely has an
 * honest number attached, so a metric is optional there and no [X%] is ever suggested.
 */
export function metricOptional(bullet: string): boolean {
  return /\b(align(ed|ing)?|coordinat\w*|escalat\w*|mitigat\w*|risks?|governance|complian\w*|liais\w*|facilitat\w*|consensus|stakeholders?|audit(ed|s)?|regulat\w*)\b/i.test(bullet);
}

const VAGUE_QUANTITY = /\b(several|multiple|many|various|numerous|countless|a number of|a few)\b/i;

/**
 * The only way a [placeholder] enters an existing bullet: by replacing a vague quantity word
 * ("several clients" → "[N] clients"). Nothing is appended. Null when there's no vague word,
 * the bullet already has a number, or a metric is optional for it.
 */
export function quantifyVague(bullet: string): string | null {
  if (hasNumber(bullet) || metricOptional(bullet) || !VAGUE_QUANTITY.test(bullet)) return null;
  return bullet.replace(VAGUE_QUANTITY, "[N]");
}

/** Any real number (not a [placeholder]) or quantified result: such bullets never get [X%] added. */
export function hasNumber(bullet: string): boolean {
  const b = bullet.replace(/\[[^\]]*\]/g, "");
  return /\d/.test(b) || hasMetric(b) || /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|dozens?|hundreds?|thousands?|millions?|half|double|twice|triple)\b/i.test(b);
}

const ING_IRREGULAR: Record<string, string> = {
  building: "built", leading: "led", writing: "wrote", making: "made", running: "ran", setting: "set",
  driving: "drove", bringing: "brought", teaching: "taught", buying: "bought", selling: "sold", holding: "held",
  growing: "grew", taking: "took", giving: "gave", choosing: "chose", sending: "sent", spending: "spent",
  cutting: "cut", shipping: "shipped", planning: "planned", getting: "got", doing: "did", seeing: "saw",
};

/** "developing new features" -> "developed new features" (for weak-phrase removal). */
export function ingToPast(word: string): string {
  const w = word.toLowerCase();
  if (ING_IRREGULAR[w]) return ING_IRREGULAR[w];
  if (!w.endsWith("ing") || w.length < 6) return w;
  const root = w.slice(0, -3);
  return root.endsWith("e") ? root + "d" : root + "ed";
}

/** Map a bullet's subject matter to a strong opener when we need to replace a weak one. */
export function suggestVerb(bullet: string): string {
  const b = bullet.toLowerCase();
  const rules: [RegExp, string][] = [
    [/\b(a\/b tests?|experiments?|split tests?)\b/, "Ran"],
    [/\b(architect|design(ed|ing)? (the|a|an)? ?(system|architecture|platform))/, "Architected"],
    [/\b(api|service|backend|endpoint|microservice|platform|feature|app|application|frontend|ui|component)s?\b/, "Engineered"],
    [/\b(pipeline|etl|automation|script|ci\/cd|deploy)/, "Automated"],
    [/\b(team|engineers|people|hires|interns|members)\b/, "Led"],
    [/\b(launch|release|roadmap|product|go-to-market|gtm)/, "Launched"],
    [/\b(performance|latency|speed|cost|efficien|slow)/, "Optimized"],
    [/\b(data|analys|report|dashboard|metric|insight|kpi)/, "Analyzed"],
    [/\b(customer|client|stakeholder|vendor|partner)/, "Partnered with"],
    [/\b(test|qa|quality|bug)/, "Strengthened"],
    [/\b(process|workflow|operation)/, "Streamlined"],
  ];
  for (const [re, v] of rules) if (re.test(b)) return v;
  return "Delivered";
}

const PAST_IRREGULAR_ING: Record<string, string> = Object.fromEntries(
  Object.entries(ING_IRREGULAR).map(([ing, past]) => [past, ing]),
);

/** "Engineered" -> "engineering", "Wrote" -> "writing", "Partnered with" -> "partnering with". */
export function pastToGerund(verbPhrase: string): string {
  const [head, ...rest] = verbPhrase.toLowerCase().split(" ");
  const g = PAST_IRREGULAR_ING[head] ?? (head.endsWith("ied") ? head.slice(0, -3) + "ying" : head.replace(/ed$/, "ing"));
  return [g, ...rest].join(" ");
}
