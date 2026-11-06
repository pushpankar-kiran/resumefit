import type { DiagnosticCheck, FormattingIssue } from "../types";
import { rootCauseOf } from "../scoring/findings";

// Campus placement: colleges often mandate a resume template (tables, a roll number, no contact
// details) and submit it through the placement office, not an employer's ATS. Formatting and
// contact checks then apply only if the candidate applies directly.

export const CAMPUS_NOTICE =
  "This looks like a campus placement template. Formatting and contact-detail checks apply only if you apply directly, so they are shown as warnings.";

/** Why the resume / JD look like campus placement (empty when they don't). */
export function campusSignals(resumeText: string, jdText: string): string[] {
  const top = resumeText.split("\n").slice(0, 6).join("\n");
  const roll = /\b[A-Z]{2,4}\d{5,8}\b/.test(top);
  const batch = /\bbatch of\s+20\d{2}/i.test(resumeText);
  const jd = /(campus (recruitment|placement|hiring|drive)|placement (committee|cell|office)|final[- ]year students)/i.test(jdText);
  const signals = [
    roll ? "a roll number at the top of the resume" : null,
    batch ? '"Batch of" on the resume' : null,
    jd ? "campus-recruitment language in the job description" : null,
  ].filter((s): s is string => !!s);
  // The JD's own wording is enough; on the resume side, a roll number AND a batch line together.
  return jd || (roll && batch) ? signals : [];
}

// Root causes that a college-mandated template decides, not the candidate.
const TEMPLATE_CAUSES = new Set(["layout", "contact", "typography"]);
const templateCheck = (id: string) => TEMPLATE_CAUSES.has(rootCauseOf(id)) || id === "columns" || id === "contact-header";

/** Formatting and contact checks become warnings (statuses and severities only; scores are unchanged). */
export function downgradeForCampus(checks: DiagnosticCheck[], issues: FormattingIssue[]): { checks: DiagnosticCheck[]; issues: FormattingIssue[] } {
  const soften = (i: FormattingIssue): FormattingIssue => ({
    ...i,
    severity: i.severity === "high" ? "medium" : i.severity,
    items: i.items?.map(soften),
  });
  return {
    checks: checks.map((c) => (c.status === "fail" && templateCheck(c.id) ? { ...c, status: "warn", detail: `${c.detail} (campus template: applies if you apply directly)` } : c)),
    issues: issues.map((i) => (templateCheck(i.items?.[0]?.id ?? i.id) ? soften(i) : i)),
  };
}
