import { deflateSync } from "node:zlib";
import { jsPDF } from "jspdf";

// Builds a two-column resume PDF in memory, laid out like the real one: a full-width header and
// summary, then a left column (experience with wrapped bullets, projects, a qualifications table)
// and a narrow gutter before a right column (skills, awards, positions, interests, languages).

export interface PdfOptions {
  /** Add a mailto: link annotation over "Email". */
  mailto?: string;
  /** Add a "Portfolio" link annotation. */
  portfolio?: string;
  /** Leave the name out (to test name confidence). */
  noName?: boolean;
  /** Draw a small logo: in the header band clear of text, or over the summary text. */
  logo?: "header" | "over-text";
}

// A real 8x8 red PNG, built here so the fixture needs no binary file.
function makePng(size = 8): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const raw = Buffer.concat(Array.from({ length: size }, () => Buffer.from([0, ...Array.from({ length: size }, () => [220, 30, 30]).flat()])));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const PNG = makePng();

type Kind = "h" | "role" | "b" | "c";
/** The left column as drawn: headings, role lines, bullets (b) and their wrapped continuations (c). */
const LEFT: [string, number, Kind][] = [];
const add = (t: string, kind: Kind) => LEFT.push([t, 0, kind]);
add("PROFESSIONAL EXPERIENCE", "h");
add("Product QA , Brightpath                                 May 2024-Sep 2025", "role");
add("Led redesign of a stagnant lead conversion process, from business", "b");
add("case to go-live, via design thinking, as-is/to-be mapping and fit-gap", "c");
add("analysis, improving lead engagement 20% to 40% and qualified", "c");
add("conversions 30%", "c");
add("Owned product backlog, writing user stories and acceptance criteria", "b");
add("for an analytics tool, cutting manual reporting time from", "c");
add("1 hour to 5 minutes", "c");
add("Aligned CXO and cross-functional stakeholders on prioritizing", "b");
add("fragmented releases in Jira, escalating and mitigating go-live risks", "c");
add("QA Lead, Lumenly                                        Mar 2022-May 2024", "role");
add("Diagnosed a pricing barrier limiting subscriber growth through data", "b");
add("funnel analysis, delivering 20% subscriber growth", "c");
add("Drove root-cause diagnosis of customer attrition, directing a phased", "b");
add("customer experience redesign, delivering a 12% reduction in churn", "c");
add("Managed 4-member team owning UAT, defect triage and escalation", "b");
add("resolution, resolving 90% of complaints without engineering", "c");
add("dependency", "c");
add("Senior QA, Northwind Games                             Jun 2019-Mar 2022", "role");
add("Redesigned test strategy and resource allocation under tight budget", "b");
add("and timeline constraints, while supporting 30% revenue growth", "c");
add("ACADEMIC PROJECTS/TRAINING", "h");
add("Partner Performance Index for Comparing Pre and Post-Deal", "b");
add("Results Across Firms", "c");
add("Built API-integrated AI agents: a browser assistant, a market comparison agent", "b");

export const RIGHT: [string, string[]][] = [
  ["KEY SKILLS", ["GENAI & AGENTIC AI", "PROJECT MANAGEMENT", "PRODUCT ROADMAP & BACKLOG", "CLOUD COMPUTING & AI APIS", "RISK MANAGEMENT", "PROGRAM GOVERNANCE", "AGILE/SCRUM DELIVERY"]],
  ["AWARDS & ACHIEVEMENTS", ["Top Performer | Lumenly | 2024", "Star of the Year | Northwind | 2022"]],
  ["POSITIONS OF RESPONSIBILITY", ["Member | Consulting Club | WSM P | 2026", "Member | CSR Committee | Northwind | 2022"]],
  ["EXTRA-CURRICULARS", ["Community Service", "Esports"]],
  ["LANGUAGES KNOWN", ["English - Advanced", "Hindi - Advanced"]],
];
export const SUMMARY = "Product management professional turning business challenges into scalable AI solutions through product strategy, ROI-driven roadmap ownership, team leadership and stakeholder management.";
export const EDUCATION_ROWS = [
  ["MBA (PGPM)", "Westbrook School of Management, Pune", "3.20/4", "2027"],
  ["B.Tech (Mechanical", "Riverside Institute of Technology and Management", "78.40%", "2019"],
  ["12th (PCM)", "Greenfield Public School", "80.00%", "2014"],
];

/** The same resume as single-column paragraphs (wrapped bullets joined), for a .docx twin. */
export function resumeParagraphs(): { left: [string, "h" | "role" | "b"][] } {
  const out: [string, "h" | "role" | "b"][] = [];
  for (const [t, , kind] of LEFT) {
    if (kind === "c") out[out.length - 1] = [`${out[out.length - 1][0]} ${t}`, "b"];
    // The PDF draws "Product QA , Brightpath" to mimic pdf.js item spacing; the .docx twin has the
    // text the writer typed.
    else out.push([kind === "role" ? t.replace(/\s{2,}/g, " ").replace(/ ,/g, ",") : t, kind]);
  }
  return { left: out };
}

export function twoColumnResumePdf(opts: PdfOptions = {}): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "a4" }); // 595 x 842
  const L = 24;
  const R = 352; // right column starts ~14pt after the left column's widest line
  let y = 40;
  doc.setFont("helvetica", "normal").setFontSize(9.6).text("Age | Gender: 27y | F", L, y);
  if (!opts.noName) doc.setFont("helvetica", "bold").setFontSize(21).text("ANANYA RAO", 209, y + 4);
  doc.setFont("helvetica", "normal").setFontSize(9.6).text("Experience: 75 Months", L, y + 14);
  if (opts.portfolio) doc.textWithLink("Portfolio", L, y + 28, { url: opts.portfolio });
  if (opts.mailto) doc.textWithLink("Email", L + 60, y + 28, { url: opts.mailto });
  if (opts.logo === "header") doc.addImage(PNG, "PNG", 523, 16, 52, 52);
  if (opts.logo === "over-text") doc.addImage(PNG, "PNG", 30, 110, 200, 30);
  y = 100;
  doc.setFont("helvetica", "bold").setFontSize(15.8).text("PROFILE SUMMARY", L, y);
  doc.setFont("helvetica", "normal").setFontSize(9.6);
  doc.text("Product management professional turning business challenges into scalable AI solutions through product strategy, ROI-driven", L, y + 20);
  doc.text("roadmap ownership, team leadership and stakeholder management.", L, y + 32);

  // ---- Left column ----
  const left = LEFT;
  let ly = y + 60;
  for (const [t, , kind] of left) {
    if (kind === "h") {
      ly += 8;
      doc.setFont("helvetica", "bold").setFontSize(15.8).text(t, L, ly);
      ly += 18;
    } else if (kind === "role") {
      doc.setFont("helvetica", "bold").setFontSize(10.4).text(t, L, ly);
      ly += 15;
    } else {
      doc.setFont("helvetica", "normal").setFontSize(9.6);
      if (kind === "b") doc.text("•", L + 4, ly);
      doc.text(t, L + 12, ly);
      ly += 12;
    }
  }
  // Qualifications table inside the left column, cells wrapping over several lines.
  ly += 10;
  doc.setFont("helvetica", "bold").setFontSize(15.8).text("QUALIFICATIONS", L, ly);
  ly += 22;
  doc.setFont("helvetica", "normal").setFontSize(8.9);
  [["Degree", 41], ["Institute/ University/ City", 124], ["%/CGPA", 266], ["Year", 313]].forEach(([t, x]) => doc.text(String(t), Number(x), ly));
  doc.setFontSize(9.6);
  ly += 22;
  doc.text("Westbrook School of", 124, ly - 6);
  doc.text("MBA (PGPM)", 27, ly);
  doc.text("3.20/4", 268, ly);
  doc.text("2027", 311, ly);
  doc.text("Management, Pune", 126, ly + 5);
  ly += 27;
  doc.text("B.Tech", 40, ly);
  doc.text("Riverside Institute of", 102, ly + 6);
  doc.text("(Mechanical", 29, ly + 12);
  doc.text("Technology and Management", 111, ly + 18);
  doc.text("78.40%", 267, ly + 12);
  doc.text("2019", 311, ly + 12);
  ly += 50;
  doc.text("12th (PCM)", 30, ly);
  doc.text("Greenfield Public School", 114, ly);
  doc.text("80.00%", 267, ly);
  doc.text("2014", 311, ly);

  // ---- Right column ----
  let ry = y + 60;
  const head = (t: string) => {
    ry += 8;
    doc.setFont("helvetica", "bold").setFontSize(15.8).text(t, R, ry);
    ry += 18;
  };
  const item = (t: string) => {
    doc.setFont("helvetica", "normal").setFontSize(9.6).text("•", R + 5, ry);
    doc.text(t, R + 12, ry);
    ry += 14;
  };
  head("KEY SKILLS");
  ["GENAI & AGENTIC AI", "PROJECT MANAGEMENT", "PRODUCT ROADMAP & BACKLOG", "CLOUD COMPUTING & AI APIS", "RISK MANAGEMENT", "PROGRAM GOVERNANCE", "AGILE/SCRUM DELIVERY"].forEach(item);
  head("AWARDS & ACHIEVEMENTS");
  ["Top Performer | Lumenly | 2024", "Star of the Year | Northwind | 2022"].forEach(item);
  head("POSITIONS OF");
  ry -= 8;
  head("RESPONSIBILITY");
  ["Member | Consulting Club | WSM P | 2026", "Member | CSR Committee | Northwind | 2022"].forEach(item);
  head("EXTRA-CURRICULARS");
  ["Community Service", "Esports"].forEach(item);
  head("LANGUAGES KNOWN");
  ["English - Advanced", "Hindi - Advanced"].forEach(item);
  return Buffer.from(doc.output("arraybuffer"));
}
