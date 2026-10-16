/**
 * Command-line analyzer (built-in engine only, no API credits).
 *
 *   npm run ats -- <resume.docx|pdf|txt> [--jd <file or "text">] [options]
 *
 * Options:
 *   --jd <path|text>     job description: a .docx/.pdf/.txt file, or the text itself (omit for general mode)
 *   --show-extracted     print the raw text the analyzer extracted, and the plain read a basic ATS
 *                        sees (body only), plus link targets, the name hint and the margin source
 *   --keep-layout        with --report: ask Claude for word swaps only (no restructure, word count
 *                        must not increase)
 *   --report <out.md>    write the "paste into Claude" Markdown report
 *   --json               print the full AnalysisResult as JSON instead of the summary
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyze } from "../src/lib/analyze";
import { highestDegree } from "../src/lib/nlp/education";
import { KNOCKOUT_VERDICT } from "../src/lib/nlp/knockouts";
import { parseResumeFile } from "../src/lib/parsers";
import { parseResume } from "../src/lib/nlp/resume";
import { skillItems } from "../src/lib/nlp/atsview";
import { buildClaudeReport } from "../src/lib/report";

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error(readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)![1].replace(/^ \* ?/gm, ""));
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
};
if (flag("--help") || flag("-h")) usage();
const valued = new Set(["--jd", "--report"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
const resumePath = positional[0];
if (!resumePath) usage("give a resume file");
if (!existsSync(resumePath)) usage(`no such file: ${resumePath}`);

async function readJd(v: string | null): Promise<string> {
  if (!v) return "";
  if (!existsSync(v)) return v; // literal JD text
  if (/\.txt$/i.test(v)) return readFileSync(v, "utf8");
  return (await parseResumeFile(readFileSync(v), path.basename(v))).text;
}

const rule = (title: string) => `\n${"=".repeat(8)} ${title} ${"=".repeat(Math.max(4, 70 - title.length))}`;

async function main() {
  const doc = await parseResumeFile(readFileSync(resumePath), path.basename(resumePath));
  const jdText = await readJd(value("--jd"));
  const r = await analyze(doc, jdText, { useLLM: false });

  if (flag("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const c = r.categoryScores;
    console.log(`${r.resume.fileName}: ${r.overallScore}/100 (${r.mode === "match" ? "match mode" : "general mode, no JD"})`);
    console.log(
      `  hard skills ${c.hardSkills ?? "—"} · experience ${c.experienceAlignment ?? "—"} · structure ${c.sectionStructure} · formatting ${c.formattingHealth} · bullets ${c.bulletImpact}`,
    );
    console.log(`  name: ${r.resume.contact.name ?? "not found"}`);
    for (const p of r.contactPresence ?? []) console.log(`  ${p.field}: ${p.state}${p.where ? ` (${p.where})` : ""}${p.value ? `: ${p.value}` : ""}${p.clue ? ` [saw "${p.clue}"]` : ""}`);
    const e = highestDegree(r.resume.education);
    console.log(`  highest degree: ${e ? `${e.degree} (${e.label}), ${e.year ?? "no year"}, ${e.status}` : "none recognised"}`);
    console.log(`  skills block: ${r.atsView.fields.find((f) => f.label === "Skills list")?.value ?? "none"}`);
    const m = doc.layout.page;
    if (m?.margins) console.log(`  margins (pt): top ${m.margins.top}, right ${m.margins.right}, bottom ${m.margins.bottom}, left ${m.margins.left} · ${m.marginSource ?? ""} · confidence ${m.marginConfidence ?? "—"}`);
    if (r.knockouts) {
      console.log(`  knockout screen: ${KNOCKOUT_VERDICT[r.knockouts.status]} (parse confidence ${r.knockouts.parseConfidence ?? "—"})`);
      for (const k of r.knockouts.checks) console.log(`    - ${k.label}: ${k.status}, ${k.confidence} confidence. ${k.candidate}`);
    }
    if (r.mode === "match") {
      const missing = r.keywords.details.filter((k) => k.credit < 0.8);
      console.log(`  keywords: ${r.keywords.matched.length} matched, ${missing.length} missing or partial`);
      for (const k of r.keywords.details) console.log(`    - [${k.matchType}] ${k.term} (${k.priority})${k.evidence ? `: "${k.evidence}"` : ""}`);
    }
    console.log(`  findings (grouped by root cause):`);
    for (const i of r.formattingIssues) console.log(`    - [${i.severity}] ${i.issue}${i.items && i.items.length > 1 ? `: ${i.items.map((x) => x.issue).join("; ")}` : ""}`);
  }

  if (flag("--show-extracted")) {
    console.log(rule("FIELDS (full parse | what a basic ATS keeps from a plain read)"));
    const ats = (label: string) => {
      const f = r.atsView.fields.find((x) => x.label === label);
      return f ? `${f.value ?? "not found"}${f.note ? ` (${f.note})` : ""}` : "—";
    };
    const nameIssue = r.diagnostics.find((d) => d.id === "contact-name");
    console.log(`name:       ${r.resume.contact.name ?? "not found"}${nameIssue?.status === "fail" ? `  ✗ ${nameIssue.detail}` : ""}  |  ATS: ${ats("Name")}`);
    for (const p of r.contactPresence ?? [])
      console.log(`${(p.field + ":").padEnd(11)} ${p.state}${p.where ? ` (${p.where})` : ""}${p.value ? ` ${p.value}` : ""}${p.clue ? ` [saw "${p.clue}"]` : ""}  |  ATS: ${ats(p.field === "linkedin" ? "LinkedIn" : p.field[0].toUpperCase() + p.field.slice(1))}`);
    for (const e of r.resume.education) console.log(`education:  ${e.degree} → ${e.label}, ${e.year ?? "no year"}, ${e.status}${e.school ? " (school entry)" : ""}`);
    console.log(`            ATS: ${ats("Education")}`);
    const full = parseResume(doc.text, doc.links, doc.nameHint);
    const skillList = skillItems(full.sections.filter((x) => x.key === "skills").flatMap((x) => x.lines));
    console.log(`skills:     ${skillList.join(" · ") || "none"} (${skillList.length})  |  ATS: ${ats("Skills list")}`);
    console.log(`experience: ${r.resume.roles.map((x) => `${x.title} @ ${x.company} (${x.dates ?? "undated"})`).join("; ")}  |  ATS: ${ats("Total experience")}`);
    const pc = r.parseConfidence;
    console.log(`parse confidence: ${pc ? `${pc.level}${pc.reasons.length ? ` (${pc.reasons.join("; ")})` : ""}` : "—"}`);
    console.log(rule("SECTIONS (in reading order)"));
    for (const sec of r.resume.sections.filter((x) => x.key !== "contact")) console.log(`${sec.canonical.padEnd(16)} ← "${sec.heading}"${sec.standard ? "" : "  (non-standard heading)"}`);
    console.log(rule("ROLES"));
    const roles = full.roles;
    for (const role of roles) {
      console.log(`${role.title} | ${role.company} | ${role.dates?.raw ?? "undated"}`);
      for (const b of role.bullets) console.log(`   • ${b}`);
    }
    const rc = r.diagnostics.find((d) => d.id === "section-roles");
    if (rc) console.log(`role-count check: ${rc.status}: ${rc.detail}`);
    console.log(rule("EDUCATION ROWS"));
    for (const e of r.resume.education) console.log(e.detail);
    console.log(rule(`EXTRACTED TEXT in reading order (${doc.layout.columns > 1 ? "columns read left, then right" : "single column"}; body, tables, text boxes, headers, footers)`));
    console.log(doc.text);
    console.log(rule("PLAIN ATS READ (body only; headers, footers and text boxes skipped)"));
    console.log(doc.naiveText);
    console.log(rule("HEADER / FOOTER TEXT"));
    console.log(doc.layout.headerFooterText || "(none)");
    console.log(rule("HYPERLINK TARGETS"));
    console.log(doc.links.length ? doc.links.join("\n") : "(none)");
    console.log(rule("PARSE NOTES"));
    console.log(`name hint (largest/boldest line near the top): ${doc.nameHint ?? "(none)"}`);
    console.log(`margins: ${doc.layout.page?.marginSource ?? "unknown source"}, confidence ${doc.layout.page?.marginConfidence ?? "—"}`);
    console.log(`layout: ${doc.layout.columns} column(s), tables ${doc.layout.hasTables ? "yes" : "no"}, text boxes ${doc.layout.hasTextBoxes ? "yes" : "no"}, images ${doc.layout.imageCount}`);
    for (const w of doc.warnings) console.log(`warning: ${w}`);
  }

  const out = value("--report");
  if (out) {
    writeFileSync(out, buildClaudeReport(r, undefined, { keepLayout: flag("--keep-layout") }), "utf8");
    console.log(`\nReport written to ${out}${flag("--keep-layout") ? " (keep-layout mode: word swaps only)" : ""}`);
  } else if (flag("--keep-layout")) console.error("\nNote: --keep-layout only changes the --report prompt.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
