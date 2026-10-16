import type { AtsField, AtsView, ParsedDocument, ParsedResume } from "../types";
import { parseResume } from "./resume";
import { describeEducation, highestDegree, resumeEducation } from "./education";
import { SKILLS } from "./skills";
import { findTerm } from "./text";

/** Taxonomy skills found in a block of text (canonical names, in taxonomy order). */
export function skillsIn(text: string): string[] {
  return SKILLS.filter((s) => [s.term, ...s.aliases].some((v) => findTerm(text, v).length)).map((s) => s.term);
}

/**
 * The items in a Skills block: split on bullets, newlines, commas, semicolons and pipes.
 * "PRODUCT ROADMAP & BACKLOG" and "AGILE/SCRUM DELIVERY" stay one item each.
 */
export function skillItems(lines: string[]): string[] {
  return lines
    .flatMap((l) => l.split(/[•·▪●◦‣\n,;|]+|\s{2,}|\t/))
    .map((s) => s.replace(/^[\s*\-–]+|[\s.:]+$/g, "").trim())
    .filter((s) => s.length >= 2 && /[A-Za-z]/.test(s) && s.split(/\s+/).length <= 6);
}

/**
 * Re-parse the resume the way a basic ATS would: reading straight across columns and
 * ignoring header/footer text and hyperlinks. The parse rate is the share of the fields a
 * recruiter's search depends on that survive that naive read.
 */
export function buildAtsView(doc: ParsedDocument, smart: ParsedResume): AtsView {
  // The formatting hint only applies if the name survives the plain read.
  const naive = parseResume(doc.naiveText, [], doc.nameHint && doc.naiveText.includes(doc.nameHint) ? doc.nameHint : null);
  const notes: string[] = [];
  const lostFromHeader = (v: string | null | undefined) => !!v && !!doc.layout.headerFooterText && doc.layout.headerFooterText.includes(v) && !doc.naiveText.includes(v);

  const contactField = (label: string, value: string | null, smartValue: string | null, weight: number): [AtsField, number] => {
    const ok = !!value;
    let note: string | undefined;
    if (!ok && lostFromHeader(smartValue)) note = "Only in the page header/footer, which many ATS skip";
    else if (!ok && smartValue) note = "Not readable in plain reading order";
    else if (!ok) note = "Not found";
    return [{ label, value, ok, note }, ok ? weight : 0];
  };

  const scored: [AtsField, number][] = [
    contactField("Name", naive.contact.name, smart.contact.name, 10),
    contactField("Email", naive.contact.email, smart.contact.email, 12),
    contactField("Phone", naive.contact.phone, smart.contact.phone, 10),
    contactField("LinkedIn", naive.contact.linkedin, smart.contact.linkedin, 3),
    [{ label: "Location", value: naive.contact.location, ok: !!naive.contact.location, note: naive.contact.location ? undefined : "Not found (some ATS filter by location)" }, naive.contact.location ? 2 : 0],
  ];

  // Sections: 5 core sections, 4 points each.
  const core = ["summary", "experience", "education", "skills"] as const;
  let sectionPts = 0;
  for (const k of core) {
    const s = naive.sections.find((x) => x.key === k);
    sectionPts += s ? (s.standard ? 5 : 3) : 0;
  }
  const sectionsField: AtsField = {
    label: "Sections recognized",
    value: `${core.filter((k) => naive.sections.some((s) => s.key === k)).length} of 4 (+ contact)`,
    ok: sectionPts >= 16,
    note: sectionPts < 20 ? "Some sections are missing or use headings an ATS may not map" : undefined,
  };
  scored.push([sectionsField, sectionPts]);

  // Work history: title, company and dates for up to three most recent roles.
  const roles = naive.roles.slice(0, 3);
  const roleFrac = roles.length ? roles.reduce((a, r) => a + (r.title ? 0.35 : 0) + (r.company ? 0.25 : 0) + (r.dates ? 0.4 : 0), 0) / roles.length : 0;
  const expectedRoles = Math.max(1, smart.roles.filter((r) => r.dates).length);
  const coverage = Math.min(1, naive.roles.filter((r) => r.dates).length / expectedRoles);
  const rolePts = Math.round(28 * roleFrac * coverage);
  scored.push([
    {
      label: "Job titles, employers & dates",
      value: roles.length ? `${naive.roles.length} role(s) parsed` : null,
      ok: rolePts >= 22,
      note: coverage < 1 ? `Only ${naive.roles.filter((r) => r.dates).length} of ${expectedRoles} dated roles survive a plain read` : roleFrac < 0.8 ? "Some titles or employers couldn't be separated from other text" : undefined,
    },
    rolePts,
  ]);

  // Every item in the Skills block counts, not only the ones the taxonomy knows.
  const skillLines = naive.sections.filter((s) => s.key === "skills").flatMap((s) => s.lines);
  const skills = skillItems(skillLines);
  const known = skillsIn(skillLines.join("\n")).length;
  scored.push([
    {
      label: "Skills list",
      value: skills.length ? `${skills.length} skills listed (${known} match known skill names)` : null,
      ok: skills.length >= 5,
      note: skills.length ? undefined : "No parseable skills section",
    },
    skills.length >= 5 ? 8 : skills.length ? 4 : 0,
  ]);

  // One education parser for every view: the full parse decides WHAT the degree is; the plain
  // read only decides whether a basic ATS would still see it.
  const edu = resumeEducation(smart);
  const plain = resumeEducation(naive);
  const top = highestDegree(edu);
  const schoolOnly = !top && edu.length > 0;
  const survives = !!top && plain.some((e) => e.level === top.level);
  scored.push([
    {
      label: "Education",
      value: top ? describeEducation(top) : null,
      ok: survives,
      note: schoolOnly ? `Only school entries found (${edu.map((e) => e.degree).join(", ")})` : !top ? "No degree recognized" : survives ? undefined : "Read from a table or text box that a basic ATS may skip",
    },
    top ? (survives ? 7 : 3) : 0,
  ]);

  const yrs = naive.totalYears;
  scored.push([{ label: "Total experience", value: yrs ? `${yrs} years` : null, ok: yrs > 0, note: yrs ? undefined : "No date ranges could be read" }, 0]);

  let parseRate = scored.reduce((a, [, p]) => a + p, 0);
  if (doc.layout.columns > 1) notes.push("Two-column layout: the plain-text view below shows how lines from both columns get merged.");
  if (doc.layout.hasTables) notes.push("Tables detected: cell order varies between ATS, so some fields may land in the wrong place.");
  if (doc.layout.hasTextBoxes) notes.push("Text boxes detected: many ATS skip their content entirely.");
  if (doc.layout.headerFooterText) notes.push("Header/footer text is excluded below, as many ATS ignore it.");
  if (doc.layout.hiddenTextChars > 20) notes.push("Hidden (white/invisible) text is still extracted by an ATS and shows up to recruiters in the parsed profile.");
  if (doc.fileType === "txt") notes.push("Plain text input: this view matches what you pasted.");
  parseRate = Math.max(0, Math.min(100, Math.round(parseRate)));

  return {
    parseRate,
    fields: scored.map(([f]) => f),
    sections: naive.sections.filter((s) => s.startLine > 0 || s.key !== "contact").map((s) => ({ heading: s.heading, mappedTo: s.key === "other" ? (s.standard ? "other (standard)" : "unmapped") : s.key, standard: s.standard })),
    roles: naive.roles.map((r) => ({ title: r.title, company: r.company, dates: r.dates?.raw ?? null, bullets: r.bullets.length })),
    education: edu.map((e) => `${describeEducation(e)}: ${e.detail}`),
    skills,
    naiveText: doc.naiveText.slice(0, 12000),
    notes,
  };
}
