import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseResumeFile, parseText } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";
import { tailorDocx } from "@/lib/docx-edit";
import { DEFAULT_OPTIONS, applyChanges, fitsLine, lineCapacity, planTailoring } from "@/lib/tailor";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const docXml = async (b: Buffer) => (await (await JSZip.loadAsync(b)).file("word/document.xml")!.async("string"));
const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;

async function tailorFile(path: string, jd: string, addKeywords: string[] = []) {
  const buf = readFileSync(path);
  const doc = await parseResumeFile(buf, path.split("/").pop()!);
  const r = await analyze(doc, jd, { useLLM: false });
  const plan = planTailoring(r, { ...DEFAULT_OPTIONS, addKeywords });
  const expected = applyChanges(r.resume.text, plan).text;
  const out = await tailorDocx(buf, plan);
  return { buf, r, plan, expected, out };
}

describe("in-place .docx tailoring", () => {
  it("edits text exactly as planned and keeps all formatting", async () => {
    const { buf, plan, expected, out } = await tailorFile("fixtures/templates/docx/word-needs-work.docx", SAMPLES[1].jd, ["OKRs"]);
    expect(plan.filter((c) => c.enabled && !c.blocked).length).toBeGreaterThanOrEqual(5);
    expect(squash(expected)).toMatch(/Work Experience|WORK EXPERIENCE/);
    expect(squash(expected)).toMatch(/Wrote PRDs/);
    expect(out.notFound).toEqual([]);
    const reparsed = await parseResumeFile(out.buffer, "out.docx");
    expect(squash(reparsed.text)).toBe(squash(expected));
    const [a, b] = [await docXml(buf), await docXml(out.buffer)];
    // Same paragraphs, runs, bold, fonts, sizes and bullets: only the text changed.
    for (const re of [/<w:p[ >]/g, /<w:r[ >]/g, /<w:b\/>/g, /<w:rFonts /g, /<w:sz /g, /<w:numPr>/g, /<w:tbl>/g]) expect(count(b, re), String(re)).toBe(count(a, re));
  });

  it("in a two-column, table-based Word resume, never lets text grow", async () => {
    const { buf, plan, out } = await tailorFile("fixtures/resume-risky.docx", SAMPLES[0].jd, ["Docker", "GraphQL", "Kubernetes"]);
    const text = (await parseResumeFile(out.buffer, "o.docx")).text;
    expect(text).toMatch(/Work Experience/); // short heading line: safe
    expect(text).not.toMatch(/Where I've Been/);
    // Wider date rewrites and keyword appends are held back: column/cell widths are unknowable.
    expect(plan.some((c) => c.kind === "date" && c.blocked)).toBe(true);
    expect(text).not.toMatch(/Docker|Kubernetes/);
    expect(count(await docXml(out.buffer), /<w:tbl>/g)).toBe(count(await docXml(buf), /<w:tbl>/g));
  });
});

describe("no extra lines", () => {
  const cases: [string, () => Promise<Awaited<ReturnType<typeof analyze>>>][] = [
    ["pm.txt", () => analyze(parseText(SAMPLES[1].resume, "pm.txt"), SAMPLES[1].jd, { useLLM: false })],
    ["dev.txt", () => analyze(parseText(SAMPLES[0].resume, "dev.txt"), SAMPLES[0].jd, { useLLM: false })],
    ["latex-classic.pdf", async () => analyze(await parseResumeFile(readFileSync("fixtures/templates/pdf/latex-classic.pdf"), "l.pdf"), SAMPLES[0].jd, { useLLM: false })],
    ["word-classic.docx", async () => analyze(await parseResumeFile(readFileSync("fixtures/templates/docx/word-classic.docx"), "w.docx"), SAMPLES[0].jd, { useLLM: false })],
  ];
  for (const [name, load] of cases) {
    it(`${name}: same line count, no line grows past its printed lines`, async () => {
      const r = await load();
      const all = ["Docker", "GraphQL", "Kubernetes", "Microservices", "Terraform", "Kafka", "Redis", "Looker", "Mixpanel", "Amplitude"];
      const plan = planTailoring(r, { ...DEFAULT_OPTIONS, metricPlaceholders: true, addKeywords: all, weaveKeywords: true });
      const before = r.resume.text.split("\n");
      const after = applyChanges(r.resume.text, plan).text.split("\n");
      expect(after.length).toBe(before.length);
      const cap = lineCapacity(r);
      before.forEach((line, i) => expect(fitsLine(line, after[i], cap), `line ${i}: ${after[i]}`).toBe(true));
      console.log(`${name}: cap ${cap}, ${plan.filter((c) => !c.blocked).length} applied, ${plan.filter((c) => c.blocked).length} blocked`);
    });
  }
});
