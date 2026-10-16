import type { PageGeometry, ParsedDocument, Typography } from "../types";
import { MAX_DOCX_UNCOMPRESSED, uncompressedSize } from "../security";
import { isColored } from "./pdf";

// DOCX parsing straight from the OOXML parts (via JSZip): body text with list structure, plus
// what plain-text extractors miss (headers/footers, text boxes, section columns, tables, images, links).

export async function parseDocx(buf: Buffer, fileName: string): Promise<ParsedDocument> {
  const JSZip = (await import("jszip")).default;
  const warnings: string[] = [];

  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("MALFORMED_FILE: This .docx file is corrupted or not a real Word document.");
  }
  // A 5 MB upload must not inflate into gigabytes (zip bomb): check the directory first.
  if (uncompressedSize(zip) > MAX_DOCX_UNCOMPRESSED) throw new Error("MALFORMED_FILE: This .docx expands to an unreasonable size and was rejected.");
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  if (!documentXml) throw new Error("MALFORMED_FILE: word/document.xml is missing from this .docx file.");

  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const listStyles = listStyleIds(stylesXml);
  const text = ooxmlText(documentXml, listStyles);

  // Headers first, then footers, each read with the same OOXML reader as the body.
  const headerFooterParts = Object.keys(zip.files)
    .filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))
    .sort((a, b) => (a.includes("header") === b.includes("header") ? a.localeCompare(b) : a.includes("header") ? -1 : 1));
  const headerFooterXml = await Promise.all(headerFooterParts.map(async (n) => (await zip.file(n)?.async("string")) ?? ""));
  const headerFooterText = headerFooterXml
    .map((x) => ooxmlText(x, listStyles))
    .filter(Boolean)
    .join("\n")
    .trim();

  const colsMatch = [...documentXml.matchAll(/<w:cols\b[^>]*w:num="(\d+)"/g)].map((m) => Number(m[1]));
  const columns = Math.max(1, ...colsMatch);
  const tableCount = (documentXml.match(/<w:tbl>/g) ?? []).length + (documentXml.match(/<w:tbl /g) ?? []).length;
  const textBoxes = (documentXml.match(/<w:txbxContent/g) ?? []).length;
  const images = (documentXml.match(/<pic:pic\b/g) ?? []).length + (documentXml.match(/<v:imagedata\b/g) ?? []).length;

  // Hyperlinks live in each part's own .rels (a header's "Portfolio" link is in header1.xml.rels).
  const relsParts = Object.keys(zip.files).filter((n) => /^word\/_rels\/.+\.xml\.rels$/.test(n));
  const links = externalLinks(await Promise.all(relsParts.map(async (n) => (await zip.file(n)?.async("string")) ?? "")), [documentXml, ...headerFooterXml]);

  const themeXml = (await zip.file("word/theme/theme1.xml")?.async("string")) ?? "";
  const { typography, hiddenTextChars } = docxTypography(documentXml, stylesXml, themeXml);

  if (!text.replace(/\s/g, "")) warnings.push("EMPTY_DOC: No readable text was found in the document body.");

  return {
    fileType: "docx",
    fileName,
    // Header/footer text is appended so contact info trapped there still gets analyzed,
    // while the layout signal flags the parsing risk.
    text: headerFooterText ? `${headerFooterText}\n${text}` : text,
    layout: {
      columns,
      hasTables: tableCount > 0,
      hasTextBoxes: textBoxes > 0,
      imageCount: images,
      headerFooterText,
      pageCount: Math.max(1, (documentXml.match(/<w:br w:type="page"\/>/g) ?? []).length + 1),
      typography,
      page: docxPage(documentXml),
      hiddenTextChars,
    },
    links,
    nameHint: nameHint(
      [...headerFooterXml.filter((_, i) => headerFooterParts[i].includes("header")), documentXml],
      Number(stylesXml.match(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/)?.[1] ?? 22),
    ),
    warnings,
    // ATS that skip headers/footers see only the body.
    // ATS that skip headers/footers usually skip floating text boxes too.
    naiveText: stripTextBoxes(text, documentXml, listStyles),
    sizeBytes: buf.length,
  };
}

const attr = (xml: string, tag: string, name: string): string | null =>
  xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]+)"`))?.[1] ?? null;

/**
 * Page size and margins from every section's w:sectPr / w:pgMar (never from table indents or
 * paragraph indents). With several sections the smallest margin per side is reported, and the
 * confidence drops to low when sections disagree.
 */
export function docxPage(documentXml: string): PageGeometry | null {
  const sects = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g) ?? [];
  const last = sects[sects.length - 1] ?? "";
  const w = Number(attr(last, "w:pgSz", "w:w"));
  const h = Number(attr(last, "w:pgSz", "w:h"));
  if (!w || !h) return null;
  // Twips → points. A missing pgMar falls back to Word's default 1" (72pt).
  const each = sects
    .filter((s) => /<w:pgMar\b/.test(s))
    .map((s) => {
      const m = (k: string) => Math.abs(Number(attr(s, "w:pgMar", `w:${k}`) ?? 1440)) / 20;
      return { top: m("top"), right: m("right"), bottom: m("bottom"), left: m("left") };
    });
  if (!each.length)
    return { width: Math.round(w / 20), height: Math.round(h / 20), margins: null, marginSource: "no w:pgMar in any section", marginConfidence: "low", sectionMargins: [] };
  const min = (k: keyof (typeof each)[number]) => Math.min(...each.map((e) => e[k]));
  const differ = each.some((e) => (["top", "right", "bottom", "left"] as const).some((k) => Math.abs(e[k] - each[0][k]) > 1));
  return {
    width: Math.round(w / 20),
    height: Math.round(h / 20),
    margins: { top: min("top"), right: min("right"), bottom: min("bottom"), left: min("left") },
    marginSource: `w:pgMar in ${each.length} section${each.length > 1 ? "s" : ""} (w:sectPr)`,
    marginConfidence: differ ? "low" : "high",
    sectionMargins: each,
  };
}

/** Character-weighted font, size, colour and bold usage from the runs in document.xml. */
function docxTypography(documentXml: string, stylesXml: string, themeXml: string): { typography: Typography | null; hiddenTextChars: number } {
  const defaults = stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] ?? "";
  const themeMinor = themeXml.match(/<a:minorFont>\s*<a:latin typeface="([^"]+)"/)?.[1] ?? "Calibri";
  const themeMajor = themeXml.match(/<a:majorFont>\s*<a:latin typeface="([^"]+)"/)?.[1] ?? themeMinor;
  const resolveFont = (rPr: string): string | null => {
    const ascii = attr(rPr, "w:rFonts", "w:ascii");
    if (ascii) return ascii;
    const theme = attr(rPr, "w:rFonts", "w:asciiTheme");
    if (theme) return /major/i.test(theme) ? themeMajor : themeMinor;
    return null;
  };
  const defFont = resolveFont(defaults) ?? themeMinor;
  const defSize = Number(attr(defaults, "w:sz", "w:val") ?? 22) / 2;

  const fonts = new Map<string, number>();
  const sizes = new Map<number, number>();
  let total = 0;
  let bold = 0;
  let colored = 0;
  let hidden = 0;
  for (const run of documentXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? []) {
    const n = (run.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("").replace(/\s/g, "").length;
    if (!n) continue;
    const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
    const color = attr(rPr, "w:color", "w:val");
    if (/<w:vanish\/>/.test(rPr) || (color && /^f{6}$/i.test(color))) {
      hidden += n;
      continue;
    }
    total += n;
    const font = resolveFont(rPr) ?? defFont;
    fonts.set(font, (fonts.get(font) ?? 0) + n);
    const size = Number(attr(rPr, "w:sz", "w:val") ?? defSize * 2) / 2;
    sizes.set(size, (sizes.get(size) ?? 0) + n);
    if (/<w:b\/>|<w:b w:val="(1|true|on)"\/>/.test(rPr)) bold += n;
    if (color && color !== "auto" && isColored(`#${color}`)) colored += n;
  }
  if (!total) return { typography: null, hiddenTextChars: hidden };
  const sorted = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
  const minSize = Math.min(...sorted.filter(([, c]) => c / total >= 0.02).map(([s]) => s));
  // Symbol/Wingdings are Word's ordinary bullet fonts; only true icon fonts count here.
  const ICON = /(fontawesome|font awesome|webdings|icomoon|material ?icons)/i;
  return {
    typography: {
      fonts: [...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([name, c]) => ({ name, share: c / total })),
      bodySize: sorted[0]?.[0] ?? null,
      minSize: Number.isFinite(minSize) ? minSize : null,
      boldShare: bold / total,
      coloredShare: colored / total,
      iconFont: [...fonts.keys()].find((f) => ICON.test(f)) ?? null,
    },
    hiddenTextChars: hidden,
  };
}

/** Remove each text box's lines from the body text (the reader inlines text-box content). */
function stripTextBoxes(text: string, documentXml: string, listStyles: Set<string>): string {
  // Word stores a text box twice (DrawingML + VML fallback); collect unique lines from both.
  const boxLines = new Set(
    (documentXml.match(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g) ?? [])
      .flatMap((box) => ooxmlText(box, listStyles).split("\n"))
      .map((l) => l.trim())
      .filter(Boolean),
  );
  if (!boxLines.size) return text;
  return text
    .split("\n")
    .filter((l) => !boxLines.has(l.trim()))
    .join("\n");
}

/** Paragraph style ids that carry numbering (e.g. python-docx/Word "List Bullet"). */
export function listStyleIds(stylesXml: string): Set<string> {
  const ids = new Set<string>();
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) if (/<w:numPr>/.test(m[2])) ids.add(m[1]);
  return ids;
}

type Para = { text: string; list: boolean };
type Frame =
  | { kind: "p"; text: string; list: boolean }
  | { kind: "tc"; paras: Para[] }
  | { kind: "tr"; cells: Para[][] };

/**
 * Plain text from a WordprocessingML part, read the way a careful ATS should:
 * - only `w:t` runs carry text (drawing offsets, sizes and field codes are ignored);
 * - `mc:AlternateContent` keeps the `mc:Choice` branch only (the `mc:Fallback` copy is dropped);
 * - text boxes (`w:txbxContent`) are read in place;
 * - table rows become "cell | cell | cell" lines; layout tables whose cells hold whole sections
 *   keep their paragraphs as separate lines;
 * - numbered/bulleted paragraphs are prefixed with "• ".
 */
export function ooxmlText(xml: string, listStyles: Set<string> = new Set()): string {
  const src = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
  const out: string[] = [];
  const stack: Frame[] = [];
  const container = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === "tc") return stack[i] as Extract<Frame, { kind: "tc" }>;
    return null;
  };
  // A finished paragraph goes into the enclosing table cell, or out as a line. Text-box
  // paragraphs inside an outer paragraph are emitted as their own lines.
  const emit = (p: Para) => {
    const top = stack[stack.length - 1];
    if (top?.kind === "tc") top.paras.push(p);
    else if (top?.kind === "p" && container() === null) out.push(fmt(p));
    else if (container()) container()!.paras.push(p);
    else out.push(fmt(p));
  };
  const fmt = (p: Para) => (p.list && p.text.trim() ? `• ${p.text.trim()}` : p.text.trim());
  const simpleCell = (paras: Para[]) => paras.filter((p) => p.text.trim()).length <= 4 && paras.every((p) => p.text.trim().length < 90 && !p.list);

  const tok = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<w:p\b[^>]*\/>|<w:p\b[^>]*>|<\/w:p>|<w:tc\b[^>]*>|<\/w:tc>|<w:tr\b[^>]*>|<\/w:tr>|<w:numPr>|<w:pStyle w:val="([^"]+)"\/>/g;
  for (const m of src.matchAll(tok)) {
    const t = m[0];
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      if (top?.kind === "p") top.text += decodeXml(m[1]);
    } else if (t === "<w:tab/>" || t.startsWith("<w:br") || t === "<w:cr/>") {
      if (top?.kind === "p") top.text += " ";
    } else if (t.startsWith("<w:p") && t.endsWith("/>") && !t.startsWith("<w:pStyle")) {
      emit({ text: "", list: false });
    } else if (t.startsWith("<w:pStyle")) {
      if (top?.kind === "p" && listStyles.has(m[2])) top.list = true;
    } else if (t === "<w:numPr>") {
      if (top?.kind === "p") top.list = true;
    } else if (t.startsWith("<w:p")) {
      stack.push({ kind: "p", text: "", list: false });
    } else if (t === "</w:p>") {
      const p = stack.pop();
      if (p?.kind === "p") emit({ text: p.text.replace(/\s+/g, " "), list: p.list });
    } else if (t.startsWith("<w:tc")) {
      stack.push({ kind: "tc", paras: [] });
    } else if (t === "</w:tc>") {
      const c = stack.pop();
      const row = stack[stack.length - 1];
      if (c?.kind === "tc" && row?.kind === "tr") row.cells.push(c.paras);
    } else if (t.startsWith("<w:tr")) {
      stack.push({ kind: "tr", cells: [] });
    } else if (t === "</w:tr>") {
      const r = stack.pop();
      if (r?.kind !== "tr") continue;
      if (r.cells.every(simpleCell)) {
        const line = r.cells.map((ps) => ps.map((p) => p.text.trim()).filter(Boolean).join(" ")).filter(Boolean).join(" | ");
        if (line) emit({ text: line, list: false });
      } else {
        for (const ps of r.cells) for (const p of ps) emit(p);
      }
    }
  }
  return (
    out
      .join("\n")
      .replace(/[ \t]+/g, " ")
      // Defensive: a negative number alone on a line, or a 16+ digit run, is drawing geometry,
      // never resume content ("-269874", "1494370027305010306050"). Years, PIN codes and phone
      // numbers (at most 15 digits) are kept.
      .split("\n")
      .map((l) => l.replace(/-?\d{16,}/g, "").trimEnd())
      .filter((l) => !/^\s*[-−]\d+\s*$/.test(l))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * The candidate's name, judged by formatting: the largest (then bold) short line in the headers
 * and the first paragraphs of the body, including table cells and text boxes. Returns null
 * unless it's clearly bigger or bolder than body text.
 */
export function nameHint(partXmls: string[], defaultSz = 22): string | null {
  let best: { text: string; score: number } | null = null;
  for (const xml of partXmls) {
    const src = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
    let n = 0;
    for (const p of src.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      if (++n > 60) break;
      let text = "";
      let size = 0;
      let bold = false;
      for (const r of p.matchAll(/<w:r[ >]([\s\S]*?)<\/w:r>/g)) {
        const t = [...r[1].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
        if (!t.trim()) continue;
        text += t;
        size = Math.max(size, Number(r[1].match(/<w:sz w:val="(\d+)"/)?.[1] ?? defaultSz));
        bold ||= /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(r[1]);
      }
      text = decodeXml(text).replace(/\s+/g, " ").trim();
      if (!/^[A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,3}$/.test(text)) continue;
      if (size <= defaultSz && !bold) continue;
      const score = size * 2 + (bold ? 3 : 0);
      if (!best || score > best.score) best = { text, score };
    }
  }
  return best?.text ?? null;
}

/** External link targets from every relationship part (body, headers, footers), incl. mailto:. */
export function externalLinks(relsXmls: string[], partXmls: string[] = []): string[] {
  const links = new Set<string>();
  for (const rels of relsXmls) for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (target && /TargetMode="External"/.test(m[0])) links.add(decodeXml(target));
  }
  // Field-code hyperlinks: HYPERLINK "https://..." inside w:instrText.
  for (const xml of partXmls) for (const m of xml.matchAll(/HYPERLINK\s+(?:\\l\s+)?&quot;([^&]+)&quot;|HYPERLINK\s+"([^"]+)"/g)) links.add(decodeXml(m[1] ?? m[2]));
  return [...links];
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}
