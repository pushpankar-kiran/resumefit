import JSZip from "jszip";

// Builds small .docx files in memory so parsing tests don't depend on files on disk.

export const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

/** A paragraph; `size` in points, optionally bold. */
export const p = (t: string, opts: { size?: number; bold?: boolean } = {}) =>
  `<w:p><w:r><w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size * 2}"/>` : ""}</w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
export const tc = (...paras: string[]) => `<w:tc><w:tcPr/>${paras.join("")}</w:tc>`;
export const tr = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
export const tbl = (...rows: string[]) => `<w:tbl><w:tblPr/>${rows.join("")}</w:tbl>`;
export const hyperlink = (rid: string, t: string) => `<w:p><w:hyperlink r:id="${rid}"><w:r><w:t>${t}</w:t></w:r></w:hyperlink></w:p>`;
export const textBox = (...paras: string[]) =>
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor>` +
  `<wp:positionH relativeFrom="column"><wp:posOffset>-269874</wp:posOffset></wp:positionH>` +
  `<wps:wsp><wps:txbx><w:txbxContent>${paras.join("")}</w:txbxContent></wps:txbx></wps:wsp>` +
  `</wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${paras.join("")}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
export const sectPr = (m: { top: number; right: number; bottom: number; left: number }) =>
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

const rels = (items: [string, string][]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>`)
    .join("")}</Relationships>`;

export async function buildDocx(opts: {
  body: string;
  header?: string;
  footer?: string;
  bodyLinks?: [string, string][];
  headerLinks?: [string, string][];
  /** Body ends with this sectPr (default: none). */
  finalSectPr?: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${opts.body}${opts.finalSectPr ?? ""}</w:body></w:document>`);
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
  );
  if (opts.header) zip.file("word/header1.xml", `<?xml version="1.0"?><w:hdr ${NS}>${opts.header}</w:hdr>`);
  if (opts.footer) zip.file("word/footer1.xml", `<?xml version="1.0"?><w:ftr ${NS}>${opts.footer}</w:ftr>`);
  if (opts.bodyLinks) zip.file("word/_rels/document.xml.rels", rels(opts.bodyLinks));
  if (opts.headerLinks) zip.file("word/_rels/header1.xml.rels", rels(opts.headerLinks));
  return zip.generateAsync({ type: "nodebuffer" });
}
