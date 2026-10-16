import type { LayoutSignals, PageGeometry, ParsedDocument, Typography } from "../types";
import { isNameLike } from "../nlp/resume";

// PDF parsing with layout forensics. We read positioned text items from pdf.js (via unpdf)
// so we can see what a naive ATS sees: column gutters, header/footer bands, grids, images.

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  /** Inside a tagged-PDF Artifact (header, footer, page number, decoration). */
  artifact?: boolean;
}

interface Line {
  y: number;
  items: Item[];
}

interface Segment {
  x0: number;
  x1: number;
  text: string;
}

const EDGE_BAND = 0.045; // top/bottom 4.5% of the page is treated as header/footer territory

export async function parsePdf(buf: Uint8Array, fileName: string): Promise<ParsedDocument> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const pdfjs = await getResolvedPDFJS();
  const OPS = pdfjs.OPS as Record<string, number>;
  const imageOps = new Set(
    [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter(
      (n) => typeof n === "number",
    ),
  );

  const textOps = new Set(
    [OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText].filter((n) => typeof n === "number"),
  );

  const sizeBytes = buf.length; // pdf.js transfers (detaches) the buffer
  // Untrusted input. The bundled pdf.js has no eval-based font path (no `new Function`), so the
  // CVE-2024-4367 class of font-program code execution can't occur here.
  const doc = await getDocumentProxy(buf);
  const warnings: string[] = [];
  const links = new Set<string>();
  const pageTexts: string[] = [];
  const naivePages: string[] = [];
  const edgeTexts: string[][] = [];
  let maxColumns = 1;
  let tableLike = false;
  let imageCount = 0;
  let hiddenTextChars = 0;
  const fontChars = new Map<string, number>();
  const sizeChars = new Map<number, number>();
  const colorChars = new Map<string, number>();
  let geometry: PageGeometry | null = null;
  let nameHint: string | null = null;
  const images: NonNullable<LayoutSignals["images"]> = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const H = viewport.height;
    const W = viewport.width;

    // Marked content lets us see Word/Docs "Artifact" tags, which is how tagged PDFs label
    // running headers, footers and page numbers wherever they sit on the page.
    const content = await page.getTextContent({ includeMarkedContent: true });
    const items: Item[] = [];
    const fontIds = new Map<string, number>();
    let artifactDepth = 0;
    const tagStack: boolean[] = [];
    for (const raw of content.items as Array<Record<string, unknown>>) {
      if (raw.type === "beginMarkedContent" || raw.type === "beginMarkedContentProps") {
        const isArtifact = raw.tag === "Artifact";
        tagStack.push(isArtifact);
        if (isArtifact) artifactDepth++;
        continue;
      }
      if (raw.type === "endMarkedContent") {
        if (tagStack.pop()) artifactDepth--;
        continue;
      }
      if (typeof raw.str !== "string" || !Array.isArray(raw.transform)) continue;
      const t = raw.transform as number[];
      const str = raw.str as string;
      if (!str.trim()) continue;
      const size = Math.hypot(t[2], t[3]) || 10;
      items.push({ str, x: t[4], y: t[5], w: Number(raw.width) || 0, size, artifact: artifactDepth > 0 });
      const n = str.replace(/\s/g, "").length;
      if (typeof raw.fontName === "string") fontIds.set(raw.fontName, (fontIds.get(raw.fontName) ?? 0) + n);
      const bucket = Math.round(size * 2) / 2;
      sizeChars.set(bucket, (sizeChars.get(bucket) ?? 0) + n);
    }

    try {
      const ops = await page.getOperatorList();
      let fill = "#000000";
      let invisible = false;
      // Current transformation matrix, so we know where each image is drawn.
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      ops.fnArray.forEach((fn, i) => {
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) ctm = multiply(args as Matrix, ctm);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm);
          if (Array.isArray(args?.[0]) && (args[0] as number[]).length >= 6) ctm = multiply(args[0] as Matrix, ctm);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        if (imageOps.has(fn)) {
          imageCount++;
          // An image fills the unit square under the CTM.
          const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
          const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
          const box = { page: p, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
          const overlapsText = items.some((it) => it.x < box.x + box.w && it.x + it.w > box.x && it.y < box.y + box.h && it.y + it.size > box.y);
          images.push({ ...box, headerBand: box.y + box.h / 2 > H * 0.8, overlapsText });
        }
        if (fn === OPS.setFillRGBColor) fill = toHex(args);
        else if (fn === OPS.setTextRenderingMode) invisible = args?.[0] === 3;
        else if (textOps.has(fn)) {
          const glyphs = (Array.isArray(args?.[0]) ? args[0] : args?.[args.length - 1]) as unknown[];
          const n = Array.isArray(glyphs)
            ? glyphs.filter((g) => g && typeof g === "object" && typeof (g as { unicode?: string }).unicode === "string" && (g as { unicode: string }).unicode.trim()).length
            : 0;
          if (!n) return;
          if (invisible || isNearWhite(fill)) hiddenTextChars += n;
          else colorChars.set(fill, (colorChars.get(fill) ?? 0) + n);
        }
      });
      // Font objects resolve once the operator list has loaded them.
      fontIds.forEach((n, id) => {
        let name = id;
        try {
          const f = page.commonObjs.get(id) as { name?: string } | undefined;
          if (f?.name) name = f.name.replace(/^[A-Z]{6}\+/, "");
        } catch {
          /* unresolved font: keep the id */
        }
        fontChars.set(name, (fontChars.get(name) ?? 0) + n);
      });
    } catch {
      /* operator list is best-effort */
    }

    if (items.length) {
      const top = Math.min(...items.map((it) => H - (it.y + it.size)));
      const bottom = Math.min(...items.map((it) => it.y));
      const left = Math.min(...items.map((it) => it.x));
      const right = Math.min(...items.map((it) => W - (it.x + it.w)));
      const m = { top, right, bottom, left };
      const prev: PageGeometry["margins"] = geometry ? (geometry as PageGeometry).margins : null;
      geometry = {
        width: Math.round(W),
        height: Math.round(H),
        margins: prev
          ? {
              top: Math.min(prev.top, m.top),
              right: Math.min(prev.right, m.right),
              bottom: Math.min(prev.bottom, m.bottom),
              left: Math.min(prev.left, m.left),
            }
          : m,
        // PDFs don't store margins: these are measured from where text is drawn.
        marginSource: "content bounding box from word coordinates (PDFs store no margin setting)",
        marginConfidence: "medium",
      };
    } else if (!geometry) geometry = { width: Math.round(W), height: Math.round(H), margins: null };
    try {
      const annots = await page.getAnnotations();
      for (const a of annots as Array<Record<string, unknown>>) {
        // URI actions: pdf.js puts web links in `url`; mailto:/tel: targets can land in `unsafeUrl`.
        if (typeof a.url === "string") links.add(a.url);
        else if (typeof a.unsafeUrl === "string" && /^(https?:|mailto:|tel:)/i.test(a.unsafeUrl)) links.add(a.unsafeUrl);
      }
    } catch {
      /* ignore */
    }

    if (p === 1) nameHint = pdfNameHint(items, H);

    const edge: string[] = [];
    const body: Item[] = [];
    for (const it of items) {
      const inBand = it.y > H * (1 - EDGE_BAND) || it.y < H * EDGE_BAND;
      // Tagged artifacts in the top/bottom 15% are running headers/footers (Word puts them ~0.5" in).
      const taggedHeader = it.artifact && (it.y > H * 0.85 || it.y < H * 0.15);
      if (inBand || taggedHeader) edge.push(it.str.trim());
      else body.push(it);
    }
    edgeTexts.push(edge);

    const lines = groupLines(body);
    const segLines = lines.map((l) => segments(l));
    // Column regions come first (word positions, full-width bands kept apart); the older
    // whole-page gutter test stays as a fallback for layouts without a long clean run.
    const regions = layoutRegions(lines, W);
    const regionCols = regions.some((r) => r.gutter !== null);
    const gutter = regionCols ? null : findGutter(segLines, W);
    if (regionCols || gutter !== null) maxColumns = Math.max(maxColumns, 2);
    if (looksTabular(segLines)) tableLike = true;

    pageTexts.push(regionCols ? renderRegions(regions, edge) : renderPage(segLines, gutter, edge));
    // A basic ATS reads each visual line straight across the page and skips header/footer bands.
    naivePages.push(segLines.map((segs) => segs.map((s) => s.text.trim()).join(" ")).join("\n"));
  }

  // Anything inside the edge bands sits where Word/Docs place running headers and footers.
  const headerFooter = new Set<string>();
  for (const e of edgeTexts) e.forEach((s) => s && headerFooter.add(s));

  // pdf.js often emits ", Brightpath" as its own item, which joins as "Product QA , Brightpath":
  // a layout artifact, not the writer's spacing.
  const text = pageTexts
    .join("\n\n")
    .replace(/\u0000/g, "")
    // A full stop only when it ends a word (" ." before a space or line end), so ".NET" stays put.
    .replace(/[ \t]+([,;:!?](?=\s|$)|\.(?=\s|$))/gm, "$1")
    .trim();
  const charsPerPage = text.replace(/\s/g, "").length / Math.max(1, doc.numPages);
  if (charsPerPage < 60) {
    warnings.push(
      imageCount > 0
        ? "SCANNED_PDF: This PDF appears to be an image-only scan. ATS systems cannot read it without OCR."
        : "EMPTY_PDF: No extractable text was found in this PDF.",
    );
  }

  const layout: LayoutSignals = {
    columns: maxColumns,
    hasTables: tableLike,
    hasTextBoxes: false,
    imageCount,
    headerFooterText: [...headerFooter].join(" "),
    pageCount: doc.numPages,
    typography: summarizeTypography(fontChars, sizeChars, colorChars),
    page: geometry,
    hiddenTextChars,
    images,
  };
  return {
    fileType: "pdf",
    fileName,
    text,
    layout,
    links: [...links],
    nameHint,
    warnings,
    naiveText: naivePages.join("\n\n").trim(),
    sizeBytes,
  };
}

type Matrix = [number, number, number, number, number, number];

/** m × n for PDF affine matrices [a b c d e f]. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

function toHex(args: unknown[]): string {
  const a = args?.[0];
  if (typeof a === "string") return a.toLowerCase();
  const nums = (args ?? []).filter((x): x is number => typeof x === "number");
  if (nums.length >= 3) return "#" + nums.slice(0, 3).map((n) => Math.round(n <= 1 ? n * 255 : n).toString(16).padStart(2, "0")).join("");
  return "#000000";
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number];
}

function isNearWhite(hex: string): boolean {
  return rgb(hex).every((c) => c >= 242);
}

/** Black, white and greys (equal channels) are neutral; everything else is "coloured". */
export function isColored(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) > 40;
}

// Word renders ordinary bullets in Symbol/Wingdings, so those only count as icon fonts when
// they carry a meaningful share of the text (see summarizeTypography).
const ICON_FONT = /(fontawesome|font awesome|webdings|icomoon|material ?icons|glyphicons|ionicons)/i;
const BULLET_FONT = /^(symbol|wingdings|zapfdingbats|dingbats?)/i;

function summarizeTypography(fontChars: Map<string, number>, sizeChars: Map<number, number>, colorChars: Map<string, number>): Typography | null {
  const total = [...fontChars.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  // Group "Calibri-Bold" / "Calibri-Italic" under one family.
  const families = new Map<string, number>();
  let bold = 0;
  fontChars.forEach((n, name) => {
    const fam = name.replace(/[-,](bold|italic|oblique|regular|light|medium|semibold|black|bolditalic|boldmt|mt|psmt|roman).*$/i, "").replace(/(MT|PSMT|PS)$/, "");
    families.set(fam, (families.get(fam) ?? 0) + n);
    if (/bold|black|heavy|semibold/i.test(name)) bold += n;
  });
  const sizeTotal = [...sizeChars.values()].reduce((a, b) => a + b, 0);
  const sizes = [...sizeChars.entries()].sort((a, b) => b[1] - a[1]);
  // Ignore tiny slivers (< 2% of text) when reporting the smallest size.
  const minSize = Math.min(...sizes.filter(([, n]) => n / sizeTotal >= 0.02).map(([s]) => s));
  const colorTotal = [...colorChars.values()].reduce((a, b) => a + b, 0);
  let colored = 0;
  colorChars.forEach((n, hex) => isColored(hex) && (colored += n));
  return {
    fonts: [...families.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, share: n / total })),
    bodySize: sizes[0]?.[0] ?? null,
    minSize: Number.isFinite(minSize) ? minSize : null,
    boldShare: bold / total,
    coloredShare: colorTotal ? colored / colorTotal : 0,
    iconFont:
      [...fontChars.entries()].find(([f, n]) => ICON_FONT.test(f) || (BULLET_FONT.test(f) && n / total > 0.03))?.[0] ?? null,
  };
}

function groupLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const tol = Math.max(2, it.size * 0.4);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

/**
 * The candidate's name on a PDF: the largest-font run of text in the top 20% of page one that
 * reads as a name (2-4 alphabetic words, not a heading, skill phrase or label such as Age,
 * Gender, Experience or Batch). It may share a visual row with other text ("Experience: 75
 * Months   ANANYA RAO"), so runs of same-size items are compared, not whole lines.
 */
export function pdfNameHint(items: Item[], H: number): string | null {
  const top = items.filter((it) => it.y + it.size > H * 0.8);
  const runs: { text: string; size: number }[] = [];
  for (const line of groupLines(top)) {
    let cur: { text: string; size: number; x1: number } | null = null;
    for (const it of line.items) {
      if (cur && Math.abs(it.size - cur.size) < 0.5 && it.x - cur.x1 < it.size * 1.6) {
        cur.text += (it.x - cur.x1 > it.size * 0.15 ? " " : "") + it.str;
        cur.x1 = it.x + it.w;
      } else {
        if (cur) runs.push(cur);
        cur = { text: it.str, size: it.size, x1: it.x + it.w };
      }
    }
    if (cur) runs.push(cur);
  }
  const ok = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ").trim() })).filter((r) => isNameLike(r.text));
  return ok.sort((a, b) => b.size - a.size)[0]?.text ?? null;
}

/** Split a line into horizontal runs separated by wide gaps. */
function segments(line: Line): Segment[] {
  const segs: Segment[] = [];
  for (const it of line.items) {
    const last = segs[segs.length - 1];
    const gap = last ? it.x - last.x1 : Infinity;
    if (last && gap < Math.max(14, it.size * 1.6)) {
      last.text += (gap > it.size * 0.15 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
      last.x1 = Math.max(last.x1, it.x + it.w);
    } else {
      segs.push({ x0: it.x, x1: it.x + it.w, text: it.str });
    }
  }
  return segs;
}

/**
 * A two-column layout leaves a vertical band in the middle of the page that almost no line
 * crosses, while many lines sit on each side of it. Right-aligned dates in a single-column
 * resume don't trigger this because full-width bullet lines cross the band.
 */
function findGutter(lines: Segment[][], W: number): number | null {
  if (lines.length < 12) return null;
  const bin = 4;
  const n = Math.ceil(W / bin);
  const cover = new Array<number>(n).fill(0);
  for (const segs of lines) {
    const seen = new Set<number>();
    for (const s of segs) for (let b = Math.floor(s.x0 / bin); b <= Math.floor(s.x1 / bin) && b < n; b++) seen.add(b);
    seen.forEach((b) => cover[b]++);
  }
  const lo = Math.floor(n * 0.22);
  const hi = Math.ceil(n * 0.78);
  const limit = Math.max(1, lines.length * 0.03);
  let best: { start: number; len: number } | null = null;
  let start = -1;
  for (let b = lo; b <= hi; b++) {
    if (cover[b] <= limit) {
      if (start < 0) start = b;
    } else if (start >= 0) {
      const len = b - start;
      if (!best || len > best.len) best = { start, len };
      start = -1;
    }
  }
  if (start >= 0 && (!best || hi - start > best.len)) best = { start, len: hi - start };
  if (!best || best.len * bin < 10) return null;
  const gx = (best.start + best.len / 2) * bin;
  const leftSegs = lines.flatMap((segs) => segs.filter((s) => s.x1 < gx));
  const rightSegs = lines.flatMap((segs) => segs.filter((s) => s.x0 > gx));
  const left = lines.filter((segs) => segs.some((s) => s.x1 < gx)).length;
  const right = lines.filter((segs) => segs.some((s) => s.x0 > gx)).length;
  // The far side must hold real prose, not a stray right-aligned date column. Word's newspaper
  // columns fill the left column first, so the right one can be short; what matters is a clean
  // gutter that nothing crosses plus genuine sentences on both sides.
  const DATE = /^(?:[A-Za-z]{3,9}\.?\s+)?\d{4}\s*[-–—]\s*(?:[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}|present|current)$|^\d{1,2}\/\d{4}/i;
  const prose = (segs: Segment[]) => segs.filter((s) => s.text.trim().split(/\s+/).length >= 4 && !DATE.test(s.text.trim())).length;
  const rightWords = rightSegs.reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  // Sidebar layouts: both sides substantial (the sidebar holds short items, not sentences).
  const sidebar = left >= lines.length * 0.3 && right >= lines.length * 0.3 && rightWords / Math.max(1, right) > 2.5;
  // Newspaper columns: one side may be short, but both carry sentences.
  const newspaper = left >= lines.length * 0.3 && right >= 3 && prose(rightSegs) >= 2 && prose(leftSegs) >= 2;
  return sidebar || newspaper ? gx : null;
}

/**
 * Real tables: several rows with 3+ aligned runs that hold phrases. A grid of one- or
 * two-word cells (a skills grid) is read row by row without harm, so it doesn't count.
 */
function looksTabular(lines: Segment[][]): boolean {
  const multi = lines.filter((s) => s.length >= 3);
  if (multi.length < 4) return false;
  const key = (segs: Segment[]) => segs.map((s) => Math.round(s.x0 / 6)).join(",");
  const groups = new Map<string, Segment[][]>();
  for (const segs of multi) groups.set(key(segs), [...(groups.get(key(segs)) ?? []), segs]);
  return [...groups.values()].some((rows) => {
    if (rows.length < 4) return false;
    const cells = rows.flat();
    const avgWords = cells.reduce((a, s) => a + s.text.trim().split(/\s+/).length, 0) / cells.length;
    return avgWords > 3;
  });
}

function renderPage(lines: Segment[][], gutter: number | null, edge: string[]): string {
  const out: string[] = [];
  // Keep edge text at the top so contact info trapped in a header still reaches the analyzer.
  if (edge.length) out.push(edge.join(" "));
  if (gutter === null) {
    out.push(...reflow(lines.map((segs) => ({ x0: segs[0]?.x0 ?? 0, text: segs.map((s) => s.text.trim()).join("   ") }))));
  } else {
    const left: Row[] = [];
    const right: Row[] = [];
    for (const segs of lines) {
      const l = segs.filter((s) => s.x0 < gutter);
      const r = segs.filter((s) => s.x0 >= gutter);
      if (l.length) left.push({ x0: l[0].x0, text: l.map((s) => s.text.trim()).join("   ") });
      if (r.length) right.push({ x0: r[0].x0, text: r.map((s) => s.text.trim()).join("   ") });
    }
    out.push(...reflow(left), "", ...reflow(right));
  }
  return out.join("\n");
}

// ---------- Column regions (word-level) ----------

interface Row {
  x0: number;
  text: string;
}

interface Region {
  lines: Line[];
  /** x of the gutter for a two-column region; null for a full-width band. */
  gutter: number | null;
}

/** An item that spans across x = gx (with a 1pt tolerance). */
const crosses = (line: Line, gx: number) => line.items.some((it) => it.x < gx - 1 && it.x + it.w > gx + 1);

const HEADING_LIKE = (t: string) => /^[A-Z0-9&/(),.' -]{3,}$/.test(t) && /[A-Z]{3}/.test(t) && t.split(/\s+/).length <= 6;

/**
 * Split a page into full-width bands and two-column regions. For every candidate gutter x in
 * the middle half of the page, find the longest vertical run of lines that no word crosses;
 * the best run with real content on both sides is a two-column region. Lines above and below
 * it (a full-width header, summary or table) are bands of their own, examined recursively.
 */
export function layoutRegions(lines: Line[], W: number): Region[] {
  if (lines.length < 8) return lines.length ? [{ lines, gutter: null }] : [];
  let best: { start: number; end: number; gxs: number[] } | null = null;
  for (let gx = W * 0.25; gx <= W * 0.75; gx += 2) {
    let start = 0;
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && !crosses(lines[i], gx)) continue;
      const run = lines.slice(start, i);
      if (run.length >= 8) {
        const side = (keep: (it: Item) => boolean) => run.map((l) => l.items.filter(keep).map((it) => it.str).join(" ").trim()).filter(Boolean);
        const left = side((it) => it.x + it.w <= gx);
        const right = side((it) => it.x >= gx);
        // Both sides must be populated (a ragged right edge or a date column isn't a gutter), and
        // each side must carry real text: phrases of 4+ words, or 2.5+ words per line on
        // average. A grid of one- or two-word skill cells is read row by row instead.
        const words = (xs: string[]) => xs.map((x) => x.split(/\s+/).length);
        const real = (xs: string[]) => words(xs).filter((n) => n >= 4).length >= 2 || words(xs).reduce((a, b) => a + b, 0) / Math.max(1, xs.length) > 2.5;
        if (left.length >= run.length * 0.3 && right.length >= run.length * 0.3 && real(left) && real(right)) {
          const len = i - start;
          if (!best || len > best.end - best.start) best = { start, end: i, gxs: [gx] };
          else if (len === best.end - best.start && start === best.start) best.gxs.push(gx);
        }
      }
      start = i + 1;
    }
  }
  if (!best) return [{ lines, gutter: null }];
  // The gutter is the middle of the widest clean band of candidate x positions.
  const gx = best.gxs[Math.floor(best.gxs.length / 2)];
  let { start, end } = best;
  // A heading sitting just above a full-width block (QUALIFICATIONS over its table) belongs to
  // that block, not to the left column.
  while (end - 1 > start && end < lines.length && lines[end - 1].items.every((it) => it.x + it.w <= gx) && HEADING_LIKE(lineText(lines[end - 1]))) end--;
  return [...layoutRegions(lines.slice(0, start), W), { lines: lines.slice(start, end), gutter: gx }, ...layoutRegions(lines.slice(end), W)];
}

function lineText(line: Line): string {
  return segments(line)
    .map((s) => s.text.trim())
    .join(" ");
}

/** The lines of one column (only its items). */
function columnLines(lines: Line[], keep: (it: Item) => boolean): Line[] {
  return lines.map((l) => ({ y: l.y, items: l.items.filter(keep) })).filter((l) => l.items.length);
}

/**
 * Lines → text in reading order. A table (a header row of 3+ short cells followed by rows whose
 * cells wrap over several lines) is rebuilt row by row as "cell | cell | cell"; everything else
 * goes through reflow (wrapped bullets and headings re-joined).
 */
export function renderLines(lines: Line[]): string[] {
  const out: string[] = [];
  let pending: Row[] = [];
  const flush = () => {
    out.push(...reflow(pending));
    pending = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const segs = segments(lines[i]);
    const header = segs.length >= 3 && segs.every((s) => s.text.trim().split(/\s+/).length <= 4) && !BULLET_START.test(segs[0].text.trim());
    if (header) {
      // The table runs until the next section heading (one run of capitals, no digits: "MBA
      // (PGPM) 3.20/4 2027" is a row, not a heading) or bullet.
      const stops = (l: Line) => {
        const t = lineText(l);
        return BULLET_START.test(t) || (HEADING_LIKE(t) && !/\d/.test(t) && segments(l).length === 1);
      };
      let end = i + 1;
      while (end < lines.length && !stops(lines[end])) end++;
      // Header cells: the line's own text items when there are a handful (they keep "%/CGPA"
      // and "Year" apart even when close together), otherwise its runs.
      const its = [...lines[i].items].sort((a, b) => a.x - b.x);
      const cols = its.length >= 3 && its.length <= 8 ? its.map((it) => ({ x0: it.x, x1: it.x + it.w, text: it.str })) : segs;
      const rows = tableRows(cols, lines.slice(i + 1, end));
      if (rows) {
        flush();
        out.push(cols.map((s) => s.text.trim()).join(" | "), ...rows);
        i = end - 1;
        continue;
      }
    }
    pending.push({ x0: segs[0]?.x0 ?? 0, text: segs.map((s) => s.text.trim()).join("   ") });
  }
  flush();
  return out;
}

/** Rows of a table under `header`: rows split at large vertical gaps, items assigned to the nearest header column. */
function tableRows(header: Segment[], body: Line[]): string[] | null {
  if (body.length < 2) return null;
  const centers = header.map((s) => (s.x0 + s.x1) / 2);
  const gaps = body.slice(1).map((l, i) => body[i].y - l.y);
  const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
  const groups: Line[][] = [[body[0]]];
  body.slice(1).forEach((l, i) => {
    // A new row starts after a gap clearly bigger than the line spacing inside a cell.
    if (gaps[i] > Math.max(typical * 1.6, 14)) groups.push([l]);
    else groups[groups.length - 1].push(l);
  });
  const rows = groups.map((g) => {
    const cells = centers.map(() => [] as string[]);
    for (const l of g)
      for (const it of [...l.items].sort((a, b) => a.x - b.x)) {
        const c = it.x + it.w / 2;
        const col = centers.reduce((best, x, k) => (Math.abs(x - c) < Math.abs(centers[best] - c) ? k : best), 0);
        cells[col].push(it.str.trim());
      }
    return cells.map((c) => c.join(" ").replace(/\s+/g, " ").trim());
  });
  // Each row must fill at least two cells, or this wasn't a table.
  if (rows.length < 2 || rows.some((r) => r.filter(Boolean).length < 2)) return null;
  return rows.map((r) => r.join(" | "));
}

/** Reading order: each band top to bottom; inside a two-column region, left column then right. */
function renderRegions(regions: Region[], edge: string[]): string {
  const out: string[] = [];
  if (edge.length) out.push(edge.join(" "));
  for (const r of regions) {
    if (r.gutter === null) {
      out.push(...renderLines(r.lines));
      continue;
    }
    const g = r.gutter;
    out.push(...renderLines(columnLines(r.lines, (it) => it.x + it.w <= g + 1)), ...renderLines(columnLines(r.lines, (it) => it.x >= g - 1)));
  }
  return out.join("\n");
}

const BULLET_START = /^[•●▪◦‣■□➢►✓-]\s*/;
const DATE_RANGE = /\b(?:[A-Z][a-z]{2,8}\.?\s*)?(?:19|20)\d{2}\s*[-–—]\s*(?:(?:[A-Z][a-z]{2,8}\.?\s*)?(?:19|20)\d{2}|present|current)\b/i;

/**
 * Re-join lines the PDF wrapped: a bullet's continuation lines (indented past the bullet glyph)
 * and a heading broken over two lines ("POSITIONS OF" / "RESPONSIBILITY").
 */
export function reflow(rows: Row[]): string[] {
  const out: string[] = [];
  let bulletX: number | null = null;
  for (const row of rows) {
    const t = row.text.trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (BULLET_START.test(t)) {
      out.push(t);
      bulletX = row.x0;
      continue;
    }
    if (bulletX !== null && row.x0 > bulletX + 2 && !HEADING_LIKE(t) && !DATE_RANGE.test(t)) {
      out[out.length - 1] = `${prev} ${t}`;
      continue;
    }
    bulletX = null;
    if (prev && HEADING_LIKE(prev) && HEADING_LIKE(t) && /(\bOF|\bAND|&|\/|\bFOR)$/.test(prev)) {
      out[out.length - 1] = `${prev} ${t}`;
      continue;
    }
    out.push(t);
  }
  return out;
}
