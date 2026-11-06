import type { AnalysisResult } from "./types";
import { keywordTotals } from "./nlp/matcher";
import { contradictingChecks } from "./scoring/engine";

// A last consistency pass over a finished analysis, printed at the end of every report: the
// keyword counts reconcile, every keyword came from the JD, and no check contradicts another.

export interface SelfCheck {
  ok: boolean;
  items: { label: string; ok: boolean; detail: string }[];
  line: string;
}

export function selfCheck(r: AnalysisResult): SelfCheck {
  const items: SelfCheck["items"] = [];
  if (r.mode === "match") {
    const t = keywordTotals(r.keywords.details);
    const buckets = [t.must, t.nice, t.soft, t.all];
    const summary = r.explanations.hardSkills.find((e) => e.label.startsWith("Must-have matched"))?.value;
    const reconcile =
      buckets.every((b) => b.matched + b.missing === b.total) && t.must.total + t.nice.total + t.soft.total === t.all.total && summary === `${t.must.matched} / ${t.must.total}`;
    items.push({
      label: "totals reconcile",
      ok: reconcile,
      detail: `${t.all.total} keywords = ${t.must.total} must-have + ${t.nice.total} nice-to-have + ${t.soft.total} soft skills; ${t.all.matched} matched + ${t.all.missing} missing`,
    });
    const outside = r.jdText ? r.keywords.details.filter((d) => !d.jdEvidence).map((d) => d.term) : [];
    items.push({ label: "no keyword outside the JD", ok: !outside.length, detail: outside.length ? `not found in the JD: ${outside.join(", ")}` : "every keyword has a JD line" });
  }
  const clash = contradictingChecks(r.diagnostics);
  items.push({ label: "no contradicting checks", ok: !clash.length, detail: clash.length ? clash.join("; ") : "checks agree" });
  const ok = items.every((i) => i.ok);
  return { ok, items, line: `Self-check: ${items.map((i) => `${i.ok ? "✓" : "✗"} ${i.label} (${i.detail})`).join("; ")}` };
}
