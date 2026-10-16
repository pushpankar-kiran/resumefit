import { diffWords } from "diff";
import { hasNumber, metricOptional } from "./verbs";

// Bullet suggestions are shown as word swaps ("Responsible for" → "Managed") with the
// word-count change, and checked against the "no appended clause" rules before they're shown.

export interface WordSwap {
  from: string;
  to: string;
}

const words = (s: string) => (s.match(/\S+/g) ?? []).length;

/** The changed spans between two versions of a bullet, as old → new pairs. */
export function wordSwaps(original: string, suggested: string): WordSwap[] {
  const out: WordSwap[] = [];
  let cur: WordSwap | null = null;
  for (const part of diffWords(original.trim(), suggested.trim())) {
    if (!part.added && !part.removed) {
      if (cur && part.value.trim()) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    cur ??= { from: "", to: "" };
    if (part.removed) cur.from += part.value;
    else cur.to += part.value;
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ from: s.from.trim(), to: s.to.trim() })).filter((s) => s.from || s.to);
}

export function wordDelta(original: string, suggested: string): number {
  return words(suggested) - words(original);
}

/**
 * Why a suggested bullet breaks the rules, or null if it's safe:
 *  - no [placeholder] on a bullet that already has a number, or on alignment/risk work;
 *  - no appended clause: the change must be substitutions or a short insertion (≤ 3 words
 *    net), and the original's ending must survive (nothing tacked on after it).
 */
export function unsafeSuggestion(original: string, suggested: string): string | null {
  const placeholder = /\[[^\]]*\]/.test(suggested) && !/\[[^\]]*\]/.test(original);
  if (placeholder && hasNumber(original)) return "adds a placeholder to a bullet that already has a number";
  if (placeholder && metricOptional(original)) return "adds a placeholder to alignment/risk work (metric optional)";
  if (wordDelta(original, suggested) > 3) return "adds more than a short insertion";
  const tail = (s: string) => s.replace(/[.\s]+$/, "").split(/\s+/).slice(-2).join(" ").toLowerCase();
  const swaps = wordSwaps(original, suggested);
  const appended = swaps.some((s) => !s.from && s.to.split(/\s+/).length >= 2) && !suggested.replace(/[.\s]+$/, "").toLowerCase().endsWith(tail(original));
  if (appended) return "appends a clause after the original ending";
  return null;
}
