// Compare Word-exported PDFs of an original and a tailored resume: pages and printed rows.
import { getDocumentProxy } from "unpdf";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
async function rows(file) {
  const doc = await getDocumentProxy(new Uint8Array(readFileSync(file)));
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const ys = new Map();
    for (const it of tc.items) if (it.str?.trim()) ys.set(Math.round(it.transform[5]), true);
    out.push(...[...ys.keys()].map((y) => `${p}:${y}`));
  }
  return { pages: doc.numPages, rows: out };
}
for (const base of process.argv.slice(3)) {
  const a = await rows(`${dir}/${base}.pdf`);
  const b = await rows(`${dir}/${base}-tailored.pdf`);
  const same = a.pages === b.pages && a.rows.length === b.rows.length && a.rows.every((r, i) => r === b.rows[i]);
  console.log(`${base.padEnd(22)} original ${a.pages}p/${a.rows.length} rows  tailored ${b.pages}p/${b.rows.length} rows  ${same ? "IDENTICAL line positions" : "DIFFERENT"}`);
}
