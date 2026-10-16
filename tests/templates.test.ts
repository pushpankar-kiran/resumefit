import { findingIds } from "@/lib/scoring/findings";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile } from "@/lib/parsers";
import type { AnalysisResult } from "@/lib/types";
import { SAMPLES } from "@/lib/samples";

// Template lab: the same resume exported in common real-world styles (Chrome-printed HTML
// templates and genuine Microsoft Word exports). Build with scripts/templates/build-templates.ps1.
// Each case states what a correct analyzer should report.

type Expect = {
  columns?: number;
  tables?: boolean;
  textBoxes?: boolean;
  headerContact?: boolean;
  images?: boolean;
  specialChars?: boolean;
  pages?: number;
  minParseRate?: number;
  maxParseRate?: number;
  roles?: number;
  emailInBody?: boolean;
};

const CASES: [string, Expect][] = [
  ["pdf/latex-classic.pdf", { columns: 1, tables: false, headerContact: false, images: false, roles: 3, minParseRate: 85, emailInBody: true }],
  ["pdf/skills-grid.pdf", { columns: 1, headerContact: false, roles: 3, minParseRate: 85, emailInBody: true }],
  ["pdf/header-contact.pdf", { columns: 1, headerContact: true, roles: 3, maxParseRate: 80, emailInBody: false }],
  ["pdf/two-page-footer.pdf", { columns: 1, headerContact: true, pages: 2, roles: 3, emailInBody: false }],
  ["pdf/modern-sidebar.pdf", { columns: 2, images: true, specialChars: true, maxParseRate: 80 }],
  ["pdf/word-classic.pdf", { columns: 1, tables: false, headerContact: false, roles: 3, minParseRate: 85, emailInBody: true }],
  ["docx/word-classic.docx", { columns: 1, tables: false, headerContact: false, roles: 3, minParseRate: 85, emailInBody: true }],
  ["pdf/word-header-contact.pdf", { headerContact: true, roles: 3, emailInBody: false }],
  ["docx/word-header-contact.docx", { headerContact: true, roles: 3, emailInBody: false, maxParseRate: 80 }],
  ["pdf/word-table-layout.pdf", { columns: 2 }],
  ["docx/word-table-layout.docx", { tables: true }],
  ["pdf/word-two-columns.pdf", { columns: 2 }],
  ["docx/word-two-columns.docx", { columns: 2 }],
  ["docx/word-textbox.docx", { textBoxes: true, emailInBody: false, maxParseRate: 80 }],
  ["pdf/word-textbox.pdf", { roles: 3 }],
];

const ROOT = "fixtures/templates";
const ready = existsSync(`${ROOT}/pdf/latex-classic.pdf`);

function observe(r: AnalysisResult) {
  const L = r.resume.layout;
  const ids = new Set(findingIds(r.formattingIssues));
  return {
    columns: L.columns,
    tables: L.hasTables,
    textBoxes: L.hasTextBoxes,
    headerContact: ids.has("contact-header"),
    images: L.imageCount > 0,
    specialChars: ids.has("special-chars") || ids.has("icon-font"),
    pages: L.pageCount,
    parseRate: r.atsView.parseRate,
    roles: r.resume.roles.filter((x) => x.dates).length,
    emailInBody: r.atsView.fields.find((f) => f.label === "Email")?.ok ?? false,
    score: r.overallScore,
  };
}

describe.skipIf(!ready)("template lab", () => {
  for (const [file, exp] of CASES) {
    it(file, async () => {
      const doc = await parseResumeFile(readFileSync(`${ROOT}/${file}`), file.split("/").pop()!);
      const r = await analyze(doc, SAMPLES[0].jd, { useLLM: false });
      const o = observe(r);
      console.log(`${file.padEnd(32)} ${JSON.stringify(o)}`);
      if (exp.columns !== undefined) expect.soft(o.columns, "columns").toBe(exp.columns);
      if (exp.tables !== undefined) expect.soft(o.tables, "tables").toBe(exp.tables);
      if (exp.textBoxes !== undefined) expect.soft(o.textBoxes, "text boxes").toBe(exp.textBoxes);
      if (exp.headerContact !== undefined) expect.soft(o.headerContact, "header/footer contact").toBe(exp.headerContact);
      if (exp.images !== undefined) expect.soft(o.images, "images").toBe(exp.images);
      if (exp.specialChars !== undefined) expect.soft(o.specialChars, "special chars").toBe(exp.specialChars);
      if (exp.pages !== undefined) expect.soft(o.pages, "pages").toBe(exp.pages);
      if (exp.roles !== undefined) expect.soft(o.roles, "dated roles").toBe(exp.roles);
      if (exp.emailInBody !== undefined) expect.soft(o.emailInBody, "email readable by ATS").toBe(exp.emailInBody);
      if (exp.minParseRate !== undefined) expect.soft(o.parseRate, "parse rate").toBeGreaterThanOrEqual(exp.minParseRate);
      if (exp.maxParseRate !== undefined) expect.soft(o.parseRate, "parse rate").toBeLessThanOrEqual(exp.maxParseRate);
    });
  }
});
