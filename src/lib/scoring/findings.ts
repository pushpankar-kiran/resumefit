import type { FormattingIssue, Severity } from "../types";

// Findings are grouped by root cause so one problem (e.g. "no contact details in the body")
// is reported once with its symptoms listed, and its score penalty is capped instead of
// stacking five separate deductions.

export type RootCause = "layout" | "contact" | "dates" | "typography" | "integrity" | "file" | "headings";

export const ROOT_CAUSES: Record<RootCause, { title: string; cap: number; recommendation: string }> = {
  layout: {
    title: "Layout an ATS may scramble (columns, tables, text boxes, graphics)",
    cap: 25,
    recommendation: "Use a single-column layout with plain text: no tables, text boxes, icons or images.",
  },
  contact: {
    title: "Contact details missing or hard for an ATS to read",
    cap: 15,
    recommendation: "Put your name, email, phone and LinkedIn as plain text at the top of the body (not in a header, footer, image or link text).",
  },
  dates: {
    title: "Dates an ATS can't use reliably",
    cap: 12,
    recommendation: 'Give every role a date range in one format, e.g. "Mar 2020 – Present", newest role first.',
  },
  typography: {
    title: "Fonts, page size and margins",
    cap: 8,
    recommendation: "Use a standard font at 10–12pt, US Letter or A4, with 0.5–1\" margins.",
  },
  integrity: {
    title: "Hidden text or keyword stuffing",
    cap: 15,
    recommendation: "Remove hidden text and mention each skill only where you actually used it.",
  },
  file: { title: "File and length", cap: 6, recommendation: "Keep it to 1–2 pages and name the file First-Last-Resume." },
  headings: {
    title: "Section headings",
    cap: 0, // section structure has its own score; grouped for readability only
    recommendation: "Use conventional headings: Professional Summary, Work Experience, Education, Skills.",
  },
};

export function rootCauseOf(id: string): RootCause {
  if (/^(multi-column|tables|text-boxes|images|icon-font|special-chars)$/.test(id)) return "layout";
  if (/^(contact-|(missing|unreadable)-(name|email|phone|linkedin)$|email-quality|link-text|web-presence)/.test(id)) return "contact";
  if (/^(date-|undated|chronology)/.test(id)) return "dates";
  if (/^(fonts|font-size|bold|color|page-size|margins)$/.test(id)) return "typography";
  if (/^(hidden-text|stuffing)$/.test(id)) return "integrity";
  if (/^(missing-|nonstandard-|unknown-heading|section-order)/.test(id)) return "headings";
  return "file";
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface Deduction {
  id: string;
  label: string;
  points: number;
}

/**
 * One issue per root cause (worst severity, symptoms listed in `items`) and one capped penalty
 * per root cause. Returns the total penalty to subtract.
 */
export function groupFindings(
  issues: FormattingIssue[],
  deductions: Deduction[] = [],
): { issues: FormattingIssue[]; penalty: number; breakdown: { cause: RootCause; title: string; raw: number; applied: number }[] } {
  const byCause = new Map<RootCause, FormattingIssue[]>();
  for (const i of issues) {
    const c = rootCauseOf(i.id);
    byCause.set(c, [...(byCause.get(c) ?? []), i]);
  }
  const rawPenalty = new Map<RootCause, number>();
  for (const d of deductions) rawPenalty.set(rootCauseOf(d.id), (rawPenalty.get(rootCauseOf(d.id)) ?? 0) + d.points);

  const grouped: FormattingIssue[] = [];
  for (const [cause, items] of byCause) {
    const meta = ROOT_CAUSES[cause];
    const sorted = [...items].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    grouped.push({
      id: `cause-${cause}`,
      severity: sorted[0].severity,
      issue: items.length === 1 ? sorted[0].issue : `${meta.title} (${items.length} findings)`,
      recommendation: items.length === 1 ? sorted[0].recommendation : meta.recommendation,
      items: sorted,
    });
  }
  const breakdown = [...rawPenalty.entries()].map(([cause, raw]) => ({
    cause,
    title: ROOT_CAUSES[cause].title,
    raw,
    applied: ROOT_CAUSES[cause].cap ? Math.min(raw, ROOT_CAUSES[cause].cap) : raw,
  }));
  return {
    issues: grouped.sort((a, b) => RANK[a.severity] - RANK[b.severity]),
    penalty: breakdown.reduce((a, b) => a + b.applied, 0),
    breakdown,
  };
}

/** Every individual finding id, inside groups or not (for checks and tests). */
export function findingIds(issues: FormattingIssue[]): string[] {
  return issues.flatMap((i) => [i.id, ...(i.items ?? []).map((x) => x.id)]);
}
