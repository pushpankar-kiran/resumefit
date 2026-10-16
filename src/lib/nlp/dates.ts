import type { DateRange } from "../types";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

// One date token. Groups: 1 month-name, 2 year | 3 mm, 4 yyyy | 5 yyyy, 6 mm | 7 yyyy
const TOKEN = `(?:(${MONTH_ALT})\\.?,?\\s+(\\d{4})|(\\d{1,2})\\s*\\/\\s*(\\d{4})|(\\d{4})-(\\d{2})(?!\\d)|(\\d{4}))`;
const END_WORD = "present|current|currently|now|today|date|ongoing";
export const RANGE_RE = new RegExp(
  `${TOKEN}\\s*(?:-|–|—|to|until|through|thru)\\s*(?:${TOKEN}|(${END_WORD}))`,
  "gi",
);

export type DateFormat = "Month YYYY" | "Mon YYYY" | "MM/YYYY" | "YYYY-MM" | "YYYY";

interface Tok {
  year: number;
  month: number;
  format: DateFormat;
}

function tok(g: (string | undefined)[]): Tok | null {
  const [mon, y1, mm, y2, y3, mm3, y4] = g;
  if (mon && y1) {
    const k = mon.toLowerCase();
    return { year: +y1, month: MONTHS[k], format: k.length > 3 && k !== "sept" ? "Month YYYY" : "Mon YYYY" };
  }
  if (mm && y2 && +mm >= 1 && +mm <= 12) return { year: +y2, month: +mm, format: "MM/YYYY" };
  if (y3 && mm3 && +mm3 >= 1 && +mm3 <= 12) return { year: +y3, month: +mm3, format: "YYYY-MM" };
  if (y4) return { year: +y4, month: 6, format: "YYYY" };
  return null;
}

const now = () => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

function plausible(y: number) {
  return y >= 1960 && y <= now().year + 1;
}

export function findDateRanges(line: string): DateRange[] {
  const out: DateRange[] = [];
  RANGE_RE.lastIndex = 0;
  for (let m = RANGE_RE.exec(line); m; m = RANGE_RE.exec(line)) {
    const g = m.slice(1);
    const start = tok(g.slice(0, 7));
    const endWord = g[14];
    const end = endWord ? "present" : tok(g.slice(7, 14));
    if (!start || !end || !plausible(start.year)) continue;
    if (end !== "present" && (!plausible(end.year) || end.year < start.year)) continue;
    out.push({ raw: m[0].trim(), start: { year: start.year, month: start.month }, end: end === "present" ? "present" : { year: end.year, month: end.month }, format: start.format });
  }
  return out;
}

/** Date-ish strings that an ATS will likely fail to parse (seasons, apostrophe years, etc.). */
export function findUnparseableDates(line: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(spring|summer|fall|autumn|winter)\s+'?\d{2,4}\b/gi,
    /(?<![\w/])'\d{2}\b/g,
    /\bQ[1-4]\s+\d{4}\b/g,
    /\b\d{1,2}\.\d{4}\b/g,
    /\b\d{4}\s*[-–—]\s*'?\d{2}(?![\d/])/g,
  ];
  for (const re of patterns) for (const m of line.matchAll(re)) out.push(m[0]);
  return out;
}

export function monthsBetween(r: DateRange): number {
  const end = r.end === "present" ? now() : r.end;
  return Math.max(0, (end.year - r.start.year) * 12 + (end.month - r.start.month) + 1);
}

/** Total experience in years, merging overlapping roles so concurrent jobs aren't double-counted. */
export function totalYears(ranges: DateRange[]): number {
  const iv = ranges
    .map((r) => {
      const e = r.end === "present" ? now() : r.end;
      return [r.start.year * 12 + r.start.month, e.year * 12 + e.month] as [number, number];
    })
    .filter(([a, b]) => b >= a)
    .sort((a, b) => a[0] - b[0]);
  let months = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1] + 1) {
      if (cur) months += cur[1] - cur[0] + 1;
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) months += cur[1] - cur[0] + 1;
  return Math.round((months / 12) * 10) / 10;
}

export function formatFamily(f: string): string {
  return f === "Month YYYY" || f === "Mon YYYY" ? "Month YYYY" : f;
}
