import type { AnalysisResult } from "./types";
import { analyze } from "./analyze";
import { parseText } from "./parsers";
import { SAFE_OPTIONS as SAFE, applyChanges, changeKey, planTailoring, selectionPlan, type ChangeKind, type TailorOptions } from "./tailor";

// Target-score ladder: every honest change ordered so the score climbs fastest, with the measured
// score after each step. The UI slider then just picks the shortest prefix that reaches the
// chosen target. Automatic fixes come first; keyword additions come after and only count if the
// user confirms they have the skill.

export interface LadderStep {
  key: string;
  kind: ChangeKind;
  label: string;
  before: string;
  after: string;
  /** Set for keyword additions: the user must confirm they really have this skill. */
  keyword?: string;
  /** Score points this step adds on top of the steps before it (measured). */
  gain: number;
  /** Projected score in the uploaded file after this step and all before it. */
  projected: number;
}

export interface Ladder {
  /** Score of the uploaded file (what the Overview shows). */
  baseScore: number;
  /** Score of the same text re-scored as plain text; projections add deltas from here. */
  textBaseline: number;
  steps: LadderStep[];
  maxProjected: number;
  /** Keywords that can't be added without adding lines. */
  noRoom: string[];
}

export { changeKey, selectionPlan };

/** No automatic fixes: used to isolate a single keyword addition. */
const NONE: TailorOptions = { headings: false, dates: false, bullets: false, spelling: false, grammar: false, filler: false, acronyms: false, metricPlaceholders: false, addKeywords: [], weaveKeywords: false };

export async function buildLadder(base: AnalysisResult): Promise<Ladder> {
  const jd = base.jdText;
  const original = base.resume.text;
  // Re-scored as plain text, like the app's Re-score; only the *difference* is applied to the file score.
  const score = async (text: string) => (await analyze(parseText(text, "target-eval-tailored.txt"), jd, { useLLM: false })).overallScore;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const textBaseline = await score(original);
  const project = (textScore: number) => clamp(base.overallScore + (textScore - textBaseline));

  // 1. Measure each candidate on its own.
  const safe = planTailoring(base, SAFE).filter((c) => !c.blocked);
  const safeGain = new Map<string, number>();
  for (const c of safe) safeGain.set(changeKey(c), (await score(applyChanges(original, [c]).text)) - textBaseline);

  const noRoom: string[] = [];
  const kwGain = new Map<string, number>();
  if (base.mode === "match") {
    const candidates = base.keywords.details.filter((m) => m.credit < 0.8 && m.category !== "soft_skill").map((m) => m.term);
    for (const k of candidates) {
      const plan = planTailoring(base, { ...NONE, addKeywords: [k] }).filter((c) => c.kind === "keyword" && !c.blocked);
      if (!plan.length) {
        noRoom.push(k);
        continue;
      }
      kwGain.set(k, (await score(applyChanges(original, plan).text)) - textBaseline);
    }
  }

  // 2. Order: automatic fixes by gain, then keywords by gain (they need the user's confirmation).
  const safeOrder = [...safe].sort((a, b) => (safeGain.get(changeKey(b)) ?? 0) - (safeGain.get(changeKey(a)) ?? 0));
  const kwOrder = [...kwGain.entries()].filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);

  // 3. Walk the order, measuring the cumulative score so interactions are accounted for.
  const steps: LadderStep[] = [];
  const keys = new Set<string>();
  const kws: string[] = [];
  let last = textBaseline;
  for (const c of safeOrder) {
    keys.add(changeKey(c));
    const s = await score(applyChanges(original, selectionPlan(base, keys, kws)).text);
    steps.push({ key: changeKey(c), kind: c.kind, label: c.label, before: c.before, after: c.after, gain: s - last, projected: project(s) });
    last = s;
  }
  for (const k of kwOrder) {
    const plan = selectionPlan(base, keys, [...kws, k]);
    // Added together with earlier keywords it may no longer fit on the Skills line.
    if (!plan.some((c) => c.kind === "keyword" && !c.blocked && c.after.includes(k))) {
      noRoom.push(k);
      continue;
    }
    kws.push(k);
    const s = await score(applyChanges(original, plan).text);
    const kwChange = plan.find((c) => c.kind === "keyword" && c.after.includes(k))!;
    const cert = base.keywords.details.find((m) => m.term === k)?.category === "certification";
    steps.push({ key: `keyword|${k}`, kind: "keyword", label: cert ? `Add "${k}" (only if you hold it)` : `Add "${k}" (only if you've really used it)`, before: kwChange.before, after: kwChange.after, keyword: k, gain: s - last, projected: project(s) });
    last = s;
  }
  return { baseScore: base.overallScore, textBaseline, steps, maxProjected: steps.length ? Math.max(base.overallScore, ...steps.map((s) => s.projected)) : base.overallScore, noRoom };
}
