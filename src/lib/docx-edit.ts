import JSZip from "jszip";
import { MAX_DOCX_UNCOMPRESSED, uncompressedSize } from "./security";
import type { TailorChange } from "./tailor";

// Applies tailoring changes to the user's original .docx in place, so the result keeps every
// font, bold run, bullet, table, margin and header. Only the characters that actually change are
// replaced: each edit is narrowed to the differing middle of before/after, and that middle is
// spliced into the runs it touches, keeping the first run's formatting.

interface Seg {
  /** Position of the text inside the part XML (content between <w:t> and </w:t>). */
  start: number;
  end: number;
  text: string;
}

interface Para {
  part: string;
  segs: Seg[];
  /** Paragraph text with tabs/breaks as spaces; `map[i]` = [segment index, offset] or null for a tab/break. */
  text: string;
  map: ([number, number] | null)[];
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Innermost paragraphs only (a paragraph holding a text box contains other paragraphs). */
function paragraphs(part: string, xml: string): Para[] {
  const out: Para[] = [];
  const pRe = /<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g;
  for (const pm of xml.matchAll(pRe)) {
    const base = pm.index!;
    const body = pm[0];
    const segs: Seg[] = [];
    let text = "";
    const map: ([number, number] | null)[] = [];
    const tokRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    for (const tm of body.matchAll(tokRe)) {
      const isBreak = /^<w:(tab|br|cr)\/>$/.test(tm[0]);
      if (!isBreak && tm[1] !== undefined) {
        const open = tm[0].indexOf(">") + 1;
        const start = base + tm.index! + open;
        const raw = tm[1];
        const t = decode(raw).replace(/ /g, " ");
        const si = segs.push({ start, end: start + raw.length, text: t }) - 1;
        for (let i = 0; i < t.length; i++) {
          map.push([si, i]);
          text += t[i];
        }
      } else if (isBreak) {
        // Tabs and line breaks read as spaces (as in the parsed text); they're never edited.
        map.push(null);
        text += " ";
      }
    }
    if (segs.length) out.push({ part, segs, text, map });
  }
  return out;
}

/** Collapse whitespace runs to one space, remembering where each normalized char came from. */
function normalize(text: string): { norm: string; idx: number[] } {
  let norm = "";
  const idx: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    const sp = /\s/.test(text[i]);
    if (sp && prevSpace) continue;
    norm += sp ? " " : text[i];
    idx.push(i);
    prevSpace = sp;
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    idx.pop();
  }
  return { norm, idx };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Shrink an edit to its differing middle: "Software 01/2021 - Present" → "01/2021 -" vs "Jan 2021 –". */
function narrow(before: string, after: string): { from: number; to: number; insert: string } {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { from: p, to: before.length - s, insert: after.slice(p, after.length - s) };
}

type Edit = { para: Para; pFrom: number; pTo: number; insert: string };

/** Turn a normalized-text range into paragraph-text indices and narrow it to the real change. */
function planEdit(para: Para, nFrom: number, nTo: number, replacement: string, idx: number[], norm: string): Edit | null {
  const before = norm.slice(nFrom, nTo);
  const { from, to, insert } = narrow(before, replacement);
  if (from === to && !insert) return null;
  const pFrom = from + nFrom < idx.length ? idx[nFrom + from] : para.text.length;
  const pTo = to + nFrom > 0 ? idx[nFrom + to - 1] + 1 : pFrom;
  return { para, pFrom, pTo: Math.max(pFrom, pTo), insert };
}

/** Splice `insert` over paragraph chars [pFrom, pTo), keeping run boundaries and formatting. */
function applyEdit(e: Edit): Map<number, string> {
  const { para, pFrom, pTo, insert } = e;
  const newText = new Map<number, string>(); // segment index -> new text
  const get = (si: number) => newText.get(si) ?? para.segs[si].text;
  // The first editable char at/after pFrom anchors the insertion (formatting of that run).
  let anchor: [number, number] | null = null;
  for (let i = pFrom; i < Math.max(pTo, pFrom + 1) && i < para.map.length && !anchor; i++) anchor = para.map[i];
  if (!anchor) {
    for (let i = pFrom - 1; i >= 0 && !anchor; i--) {
      const m = para.map[i];
      if (m) anchor = [m[0], m[1] + 1];
    }
  }
  if (!anchor) return newText;
  // Delete the covered characters (from the end so offsets stay valid), then insert at the anchor.
  const covered: [number, number][] = [];
  for (let i = pFrom; i < pTo; i++) if (para.map[i]) covered.push(para.map[i]!);
  for (const [si, off] of covered.reverse()) {
    const t = get(si);
    newText.set(si, t.slice(0, off) + t.slice(off + 1));
  }
  const [asi, aoff] = anchor;
  const t = get(asi);
  newText.set(asi, t.slice(0, aoff) + insert + t.slice(aoff));
  return newText;
}

export interface DocxTailorResult {
  buffer: Buffer;
  applied: string[];
  notFound: string[];
}

/** Apply enabled changes to a .docx, returning the edited file. */
export async function tailorDocx(input: Buffer, changes: TailorChange[]): Promise<DocxTailorResult> {
  const zip = await JSZip.loadAsync(input);
  if (uncompressedSize(zip) > MAX_DOCX_UNCOMPRESSED) throw new Error("This .docx expands to an unreasonable size.");
  const partNames = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  const parts = new Map<string, string>();
  for (const n of partNames) parts.set(n, (await zip.file(n)!.async("string")) ?? "");

  const applied: string[] = [];
  const notFound: string[] = [];

  for (const c of changes.filter((x) => x.enabled && !x.blocked)) {
    let done = false;
    for (const name of partNames) {
      if (done && !c.regex?.flags.includes("g")) break;
      const xml = parts.get(name)!;
      const paras = paragraphs(name, xml);
      const edits: Edit[] = [];
      for (const para of paras) {
        const { norm, idx } = normalize(para.text);
        if (c.regex) {
          const re = new RegExp(c.find, c.regex.flags.includes("g") ? c.regex.flags : c.regex.flags + "g");
          for (const m of norm.matchAll(re)) {
            const replacement = m[0].replace(new RegExp(c.find, c.regex.flags.replace("g", "")), c.replace);
            const e = planEdit(para, m.index!, m.index! + m[0].length, replacement, idx, norm);
            if (e) edits.push(e);
            if (!c.regex.flags.includes("g")) break;
          }
        } else {
          const find = squash(c.find);
          const at = norm.indexOf(find);
          if (at >= 0) {
            const e = planEdit(para, at, at + find.length, squash(c.replace), idx, norm);
            if (e) edits.push(e);
          }
        }
        if (edits.length && !c.regex?.flags.includes("g")) break;
      }
      if (!edits.length) continue;
      // Apply edits paragraph by paragraph, writing changed <w:t> contents back from the end.
      const writes: { start: number; end: number; text: string }[] = [];
      for (const e of edits) {
        const changed = applyEdit(e);
        changed.forEach((text, si) => writes.push({ start: e.para.segs[si].start, end: e.para.segs[si].end, text }));
        // Keep later edits in the same paragraph consistent with this one.
        changed.forEach((text, si) => (e.para.segs[si].text = text));
      }
      let out = xml;
      for (const w of writes.sort((a, b) => b.start - a.start)) out = out.slice(0, w.start) + encode(w.text) + out.slice(w.end);
      // Edited runs may now start or end with a space; tell Word to keep it (harmless elsewhere).
      out = out.replace(/<w:t>/g, '<w:t xml:space="preserve">');
      parts.set(name, out);
      done = true;
    }
    (done ? applied : notFound).push(c.id);
  }

  parts.forEach((xml, name) => zip.file(name, xml));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, applied, notFound };
}
