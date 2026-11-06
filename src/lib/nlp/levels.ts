// Consulting / corporate career ladders. Levels use the same 0-6 scale as the seniority score
// (engine.ts LEVELS): Analyst < Senior Analyst < Consultant < Associate Manager (first-line
// manager, the "Lead" rung) < Manager / Senior Manager < Director+.

export interface LadderLevel {
  level: number;
  label: string;
}

const LABEL: Record<number, string> = {
  1: "Analyst (entry level)",
  2: "Senior Analyst",
  3: "Consultant",
  4: "Associate Manager / first-line manager",
  5: "Manager / Senior Manager",
  6: "Director+",
};

// Accenture career levels: CL12 Associate, CL11 Analyst, CL10 Senior Analyst, CL9 Consultant,
// CL8 Associate Manager, CL7 Manager, CL6 Senior Manager, CL5 Associate Director, CL4-CL1 above.
const CL: Record<number, number> = { 13: 1, 12: 1, 11: 1, 10: 2, 9: 3, 8: 4, 7: 5, 6: 5, 5: 6, 4: 6, 3: 6, 2: 6, 1: 6 };

const NAMES: [RegExp, number][] = [
  [/\b(associate director|director|partner|managing director|vice president)\b/i, 6],
  [/\bsenior manager\b/i, 5],
  [/\bassociate manager\b/i, 4],
  [/\bmanager\b/i, 5],
  [/\b(senior analyst|senior associate)\b/i, 2],
  [/\bconsultant\b/i, 3],
  [/\banalyst\b/i, 1],
];

/** A ladder level from an explicit level field ("CL8 - Associate Manager") or a ladder title. */
export function ladderLevel(text: string): LadderLevel | null {
  if (!text) return null;
  const cl = text.match(/\bCL\s?-?(\d{1,2})\b/i);
  if (cl && CL[Number(cl[1])] !== undefined) return { level: CL[Number(cl[1])], label: LABEL[CL[Number(cl[1])]] };
  for (const [re, level] of NAMES) if (re.test(text)) return { level, label: LABEL[level] };
  return null;
}

/** The JD's explicit level field ("Level: CL8 - Associate Manager", "Career Level: 9"), if any. */
export function levelField(jd: string): string | null {
  return jd.match(/^\s*(?:career\s+)?(?:level|grade|band)\s*[:\-–]\s*(.{2,60})$/im)?.[1].trim() ?? null;
}
