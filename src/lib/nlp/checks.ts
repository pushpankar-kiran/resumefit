import type { DiagnosticCheck, FormattingIssue, KeywordMatch, LayoutSignals, ParsedDocument, ParsedResume, Severity } from "../types";

// Document-level checks beyond layout: typography, page setup, file hygiene, contact
// quality, chronology, section order and keyword stuffing. Each check yields a checklist
// row, an optional issue, and an optional deduction from the Formatting & Parse Health score.

export interface CheckResult {
  checks: DiagnosticCheck[];
  issues: FormattingIssue[];
  deductions: { id: string; label: string; points: number }[];
}

type Builder = CheckResult & {
  add: (c: DiagnosticCheck, issue?: Omit<FormattingIssue, "id"> & { id?: string }, points?: number) => void;
};

function result(): Builder {
  const r: Builder = {
    checks: [],
    issues: [],
    deductions: [],
    add(c, issue, points = 0) {
      r.checks.push(c);
      if (issue) r.issues.push({ id: issue.id ?? c.id, severity: issue.severity, issue: issue.issue, recommendation: issue.recommendation });
      if (points) r.deductions.push({ id: c.id, label: c.label, points });
    },
  };
  return r;
}

// Fonts every major ATS and OS renders reliably.
const SAFE_FONTS =
  /^(arial|calibri|carlito|helvetica|times|timesnewroman|times new roman|garamond|ebgaramond|georgia|cambria|verdana|tahoma|trebuchet|book ?antiqua|palatino|lato|roboto|open ?sans|opensans|source ?sans|liberation|dejavu|segoe ?ui|aptos|noto ?sans|inter|helveticaneue|arialmt|aria)/i;

const pt = (n: number) => `${Math.round(n * 10) / 10}pt`;
const inch = (n: number) => `${(n / 72).toFixed(2)}"`;

export function typographyChecks(layout: LayoutSignals, fileType: string): CheckResult {
  const r = result();
  const t = layout.typography;
  if (fileType === "txt" || !t) {
    r.add({ id: "fonts", label: "Fonts, sizes & colours", status: "pass", detail: fileType === "txt" ? "Plain text has no typography to check." : "Font data not available for this file." });
    return r;
  }
  const families = t.fonts.filter((f) => f.share >= 0.03);
  const unsafe = families.filter((f) => !SAFE_FONTS.test(f.name.replace(/[-_]/g, " ")));
  if (t.iconFont) {
    r.add(
      { id: "icon-font", label: "No icon fonts", status: "fail", detail: `Icon font "${t.iconFont}" found.` },
      { severity: "high", issue: `Icon font "${t.iconFont}" used (phone/email/location icons)`, recommendation: "Replace icons with plain words like \"Phone:\" and \"Email:\". ATS read icon glyphs as garbage characters." },
      10,
    );
  }
  r.add(
    {
      id: "fonts",
      label: "ATS-safe fonts",
      status: unsafe.length ? "warn" : families.length > 3 ? "warn" : "pass",
      detail: families.map((f) => `${f.name} ${Math.round(f.share * 100)}%`).join(", ") || "—",
    },
    unsafe.length
      ? { severity: "low", issue: `Uncommon font${unsafe.length > 1 ? "s" : ""}: ${unsafe.map((f) => f.name).join(", ")}`, recommendation: "Use a standard font such as Arial, Calibri, Garamond, Georgia or Helvetica so text extracts cleanly everywhere." }
      : families.length > 3
        ? { severity: "low", issue: `${families.length} different fonts used`, recommendation: "Stick to one font (two at most: one for headings, one for body)." }
        : undefined,
    unsafe.length ? 3 : families.length > 3 ? 2 : 0,
  );
  if (t.bodySize !== null) {
    const small = t.bodySize < 9.5;
    const large = t.bodySize > 12.5;
    const tiny = t.minSize !== null && t.minSize < 8;
    r.add(
      { id: "font-size", label: "Readable font size", status: small || tiny ? "warn" : large ? "warn" : "pass", detail: `Body text ${pt(t.bodySize)}${t.minSize !== null ? `, smallest ${pt(t.minSize)}` : ""}.` },
      small || tiny
        ? { severity: "medium", issue: `Text is too small (body ${pt(t.bodySize)}${tiny ? `, some text at ${pt(t.minSize!)}` : ""})`, recommendation: "Use 10-12pt for body text and never go below 8pt; small text often OCRs and parses badly." }
        : large
          ? { severity: "low", issue: `Body text is large (${pt(t.bodySize)})`, recommendation: "10-12pt body text keeps the resume to 1-2 pages." }
          : undefined,
      small || tiny ? 4 : 0,
    );
  }
  r.add(
    { id: "bold", label: "Bold used sparingly", status: t.boldShare > 0.4 ? "warn" : "pass", detail: `${Math.round(t.boldShare * 100)}% of text is bold.` },
    t.boldShare > 0.4 ? { severity: "low", issue: `${Math.round(t.boldShare * 100)}% of the text is bold`, recommendation: "Reserve bold for your name, headings and job titles so emphasis still means something." } : undefined,
  );
  r.add(
    { id: "color", label: "Dark text on white", status: t.coloredShare > 0.15 ? "warn" : "pass", detail: `${Math.round(t.coloredShare * 100)}% of text is coloured.` },
    t.coloredShare > 0.15 ? { severity: "low", issue: `${Math.round(t.coloredShare * 100)}% of text is in colour`, recommendation: "Keep body text black or dark grey; coloured text can print poorly and lower contrast." } : undefined,
  );
  return r;
}

export function pageChecks(layout: LayoutSignals): CheckResult {
  const r = result();
  const p = layout.page;
  if (!p) return r;
  const letter = Math.abs(p.width - 612) < 6 && Math.abs(p.height - 792) < 6;
  const a4 = Math.abs(p.width - 595) < 6 && Math.abs(p.height - 842) < 6;
  r.add(
    { id: "page-size", label: "Standard page size", status: letter || a4 ? "pass" : "warn", detail: letter ? "US Letter." : a4 ? "A4." : `${inch(p.width)} × ${inch(p.height)}.` },
    letter || a4 ? undefined : { severity: "medium", issue: `Non-standard page size (${inch(p.width)} × ${inch(p.height)})`, recommendation: "Use US Letter (8.5×11\") for US roles or A4 elsewhere." },
    letter || a4 ? 0 : 3,
  );
  if (p.margins) {
    const m = p.margins;
    // The bottom margin of a page that isn't full is meaningless, so only "too small" counts there.
    const tooSmall = Math.min(m.top, m.left, m.right, m.bottom) < 28;
    const tooBig = Math.max(m.top, m.left, m.right) > 110;
    r.add(
      {
        id: "margins",
        label: "Margins between 0.4\" and 1.5\"",
        status: tooSmall || tooBig ? "warn" : "pass",
        detail:
          `Top ${inch(m.top)}, left ${inch(m.left)}, right ${inch(m.right)}${m.bottom < 72 ? `, bottom ${inch(m.bottom)}` : ""}.` +
          (p.marginSource ? ` Source: ${p.marginSource}; confidence ${p.marginConfidence ?? "medium"}.` : "") +
          (p.marginConfidence === "low" && (p.sectionMargins?.length ?? 0) > 1 ? " Sections use different margins; the smallest per side is shown." : ""),
      },
      tooSmall
        ? { severity: "medium", issue: "Margins are under 0.4\"", recommendation: "Use 0.5-1\" margins. Text crammed to the edge can be clipped when printed or converted." }
        : tooBig
          ? { severity: "low", issue: "Margins are over 1.5\"", recommendation: "Margins of 0.5-1\" give your content more room." }
          : undefined,
      tooSmall ? 3 : 0,
    );
  }
  return r;
}

const SPECIAL = /[-☀-➿\u{1F300}-\u{1FAFF}←-⇿■-◿✀-➿]/gu;
const ALLOWED_SPECIAL = new Set(["•", "▪", "◦", "●", "–", "—"]);

export function characterChecks(text: string, layout: LayoutSignals): CheckResult {
  const r = result();
  const found = (text.match(SPECIAL) ?? []).filter((c) => !ALLOWED_SPECIAL.has(c));
  const uniq = [...new Set(found)];
  r.add(
    { id: "special-chars", label: "No icons or special symbols", status: uniq.length ? "warn" : "pass", detail: uniq.length ? `Found: ${uniq.slice(0, 8).join(" ")}` : "Only standard characters and bullets." },
    uniq.length ? { severity: "medium", issue: `${found.length} special symbol(s): ${uniq.slice(0, 6).join(" ")}`, recommendation: "Use plain round bullets (•) or hyphens. Arrows, stars, checkmarks and icon glyphs often turn into ? or □ in an ATS." } : undefined,
    uniq.length ? Math.min(6, 2 + uniq.length) : 0,
  );
  if (layout.hiddenTextChars > 20) {
    r.add(
      { id: "hidden-text", label: "No hidden text", status: "fail", detail: `${layout.hiddenTextChars} characters of white or invisible text.` },
      { severity: "high", issue: `Hidden text detected (${layout.hiddenTextChars} characters in white or invisible ink)`, recommendation: "Remove it. Hidden keywords are a known trick; recruiters see them in the parsed text and many ATS flag or penalise it." },
      15,
    );
  } else r.add({ id: "hidden-text", label: "No hidden text", status: "pass", detail: "No white or invisible text found." });
  return r;
}

const GENERIC_NAME = /^(resume|cv|my[ _-]?resume|document\d*|untitled|new|final|draft|copy|scan)\b/i;

export function fileChecks(doc: ParsedDocument, candidateName: string | null): CheckResult {
  const r = result();
  if (doc.fileName.startsWith("pasted") || /sample|-tailored\.txt$/.test(doc.fileName)) {
    r.add({ id: "file", label: "File name, type & size", status: "pass", detail: "Pasted text: no file to check." });
    return r;
  }
  const base = doc.fileName.replace(/\.[^.]+$/, "");
  const nameTokens = (candidateName ?? "").toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const hasName = nameTokens.some((t) => base.toLowerCase().includes(t));
  const messy = /[()[\]{}#%&@!$^*=+~`]|\s{2,}|(v\d+|final|copy|\(\d+\))/i.test(base);
  const issues: string[] = [];
  if (!hasName || GENERIC_NAME.test(base)) issues.push("doesn't include your name");
  if (messy) issues.push("has version tags or special characters");
  const sizeMB = doc.sizeBytes / 1024 / 1024;
  r.add(
    { id: "file-name", label: "Professional file name", status: issues.length ? "warn" : "pass", detail: `"${doc.fileName}"` },
    issues.length
      ? { severity: "low", issue: `File name ${issues.join(" and ")}`, recommendation: `Name it like "${(candidateName ?? "First Last").replace(/\s+/g, "-")}-Resume.${doc.fileType}" so recruiters can find it later.` }
      : undefined,
  );
  r.add(
    { id: "file-size", label: "File under 2 MB", status: sizeMB > 2 ? "warn" : "pass", detail: `${sizeMB < 0.1 ? Math.round(doc.sizeBytes / 1024) + " KB" : sizeMB.toFixed(1) + " MB"}.` },
    sizeMB > 2 ? { severity: "medium", issue: `File is ${sizeMB.toFixed(1)} MB`, recommendation: "Many ATS and job boards cap uploads at 2 MB. Remove images or re-export." } : undefined,
    sizeMB > 2 ? 3 : 0,
  );
  r.add(
    {
      id: "file-type",
      label: "ATS-friendly file type",
      status: doc.fileType === "txt" ? "warn" : "pass",
      detail: doc.fileType === "pdf" ? "PDF: fine for most modern ATS. A few older systems (e.g. some Taleo setups) parse .docx more reliably; upload .docx when the posting asks for Word." : doc.fileType === "docx" ? "DOCX: the most reliably parsed format." : "TXT: loses all formatting; use only where a portal asks for plain text.",
    },
    doc.fileType === "txt" ? { severity: "low", issue: "Uploaded as plain text", recommendation: "Submit a .docx or text-based PDF; keep plain text for copy-paste boxes." } : undefined,
  );
  return r;
}

const UNPRO_EMAIL = /(sexy|hot|babe|baby|cutie|cute|princess|prince|queen|king|gamer|gaming|420|69|lol|xoxo|ninja|rockstar|party|drunk|boss|swag|lover|angel|devil|kitty|bunny|fluffy|dude)/i;
const DATED_DOMAINS = /@(aol|hotmail|yahoo|rediffmail|msn|ymail|juno|earthlink|comcast)\./i;

export function contactQualityChecks(resume: ParsedResume, links: string[], targetTitle: string): CheckResult {
  const r = result();
  const email = resume.contact.email;
  if (email) {
    const local = email.split("@")[0];
    const unpro = UNPRO_EMAIL.test(local);
    const birthYear = /(19[5-9]\d|200\d)/.test(local);
    const dated = DATED_DOMAINS.test(email);
    r.add(
      { id: "email-quality", label: "Professional email address", status: unpro ? "fail" : birthYear || dated ? "warn" : "pass", detail: email },
      unpro
        ? { severity: "medium", issue: `Email "${email}" may read as unprofessional`, recommendation: "Use a simple firstname.lastname@ address." }
        : birthYear
          ? { severity: "low", issue: "Email contains what looks like a birth year", recommendation: "Drop the year; it reveals your age and invites bias." }
          : dated
            ? { severity: "low", issue: `Email uses an older provider (${email.split("@")[1]})`, recommendation: "Some recruiters read AOL/Hotmail/Yahoo addresses as dated. A Gmail, Outlook or personal-domain address is safer." }
            : undefined,
      unpro ? 3 : 0,
    );
  }

  const text = resume.text;
  const all = [...links, ...(text.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s|,)]*)?/gi) ?? [])];
  const github = all.find((l) => /github\.com\/[\w-]+/i.test(l));
  // A portfolio is a known portfolio host, or any personal link sitting behind a label such as
  // "Portfolio", "Website" or "Blog" (e.g. a "Portfolio" hyperlink to a netlify.app site).
  const personal = (l: string) => /^https?:\/\//i.test(l) && !/linkedin\.com|github\.com|mailto:|tel:/i.test(l);
  const portfolio =
    all.find((l) => /(behance\.net|dribbble\.com|\.dev\b|\.io\/|portfolio|\.me\b|medium\.com\/@|kaggle\.com|netlify\.app|vercel\.app|github\.io|notion\.site|carrd\.co|wixsite\.com|sites\.google\.com)/i.test(l)) ??
    (/\b(portfolio|website|personal site|blog)\b/i.test(text) ? links.find(personal) : undefined);
  const technical = /(engineer|developer|data|scientist|devops|sre|architect|ml|analyst|programmer)/i.test(targetTitle || resume.roles[0]?.title || "");
  const design = /(design|ux|ui|creative|art|brand|product designer|writer|content)/i.test(targetTitle || resume.roles[0]?.title || "");
  const parts = [resume.contact.linkedin ? "LinkedIn ✓" : "LinkedIn ✗", github ? "GitHub ✓" : technical ? "GitHub ✗" : null, portfolio ? "Portfolio ✓" : design ? "Portfolio ✗" : null].filter(Boolean);
  const missingWeb = (technical && !github) || (design && !portfolio);
  r.add(
    { id: "web-presence", label: "Web presence", status: missingWeb ? "warn" : "pass", detail: parts.join(" · ") },
    missingWeb
      ? { severity: "low", issue: technical ? "No GitHub link for a technical role" : "No portfolio link for a design/creative role", recommendation: technical ? "Add your GitHub (or GitLab) profile URL next to LinkedIn if it shows relevant work." : "Add a portfolio URL (Behance, Dribbble or your own site) next to LinkedIn." }
      : undefined,
  );

  // A link only behind anchor text ("LinkedIn") is lost when an ATS reads plain text.
  const hiddenLinks = links.filter((l) => /linkedin\.com|github\.com/i.test(l) && !text.toLowerCase().includes(l.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase().slice(0, 25)));
  if (hiddenLinks.length) {
    r.add(
      { id: "link-text", label: "Links written out in full", status: "warn", detail: `${hiddenLinks.length} link(s) only behind clickable text.` },
      { severity: "medium", issue: "Profile links are hidden behind anchor text", recommendation: `Write the URL itself (e.g. ${hiddenLinks[0].replace(/^https?:\/\/(www\.)?/i, "")}); ATS extract text, not hyperlinks.` },
      3,
    );
  }
  return r;
}

export function chronologyChecks(resume: ParsedResume): CheckResult {
  const r = result();
  const dated = resume.roles.filter((x) => x.dates);
  if (dated.length >= 2) {
    const key = (d: NonNullable<(typeof dated)[number]["dates"]>) => (d.end === "present" ? 999999 : d.end.year * 12 + d.end.month) * 1e6 + d.start.year * 12 + d.start.month;
    let ok = true;
    for (let i = 1; i < dated.length; i++) if (key(dated[i].dates!) > key(dated[i - 1].dates!)) ok = false;
    r.add(
      { id: "chronology", label: "Reverse-chronological order", status: ok ? "pass" : "fail", detail: ok ? "Most recent role first." : "Roles are not ordered newest → oldest." },
      ok ? undefined : { severity: "medium", issue: "Experience is not in reverse-chronological order", recommendation: "List your most recent role first. ATS and recruiters assume the top role is your current one." },
      ok ? 0 : 5,
    );
  }
  return r;
}

export function sectionOrderChecks(resume: ParsedResume): CheckResult {
  const r = result();
  const order = resume.sections.filter((s) => s.key !== "other").map((s) => s.key);
  const idx = (k: string) => order.indexOf(k as never);
  const problems: string[] = [];
  const contactLate = !!resume.contact.email && resume.text.indexOf(resume.contact.email) > resume.text.length * 0.5;
  if (contactLate) problems.push("contact details sit at the bottom");
  if (idx("summary") > 1 && idx("experience") >= 0 && idx("summary") > idx("experience")) problems.push("summary comes after experience");
  if (resume.totalYears >= 3 && idx("education") >= 0 && idx("experience") >= 0 && idx("education") < idx("experience")) problems.push("education is above experience for an experienced candidate");
  r.add(
    { id: "section-order", label: "Conventional section order", status: problems.length ? "warn" : "pass", detail: problems.length ? problems.join("; ") : order.map((k) => k[0].toUpperCase() + k.slice(1)).join(" → ") },
    problems.length ? { severity: "low", issue: `Unusual section order: ${problems.join("; ")}`, recommendation: "Use Contact → Summary → Experience → Skills → Education (put Education first only if you're a student or recent graduate)." } : undefined,
  );
  return r;
}

/** Keyword stuffing in the uploaded resume: a term repeated far beyond natural use, or a skills dump. */
export function stuffingChecks(resume: ParsedResume, matches: KeywordMatch[]): CheckResult {
  const r = result();
  const heavy = matches.filter((m) => m.resumeCount >= 8 && m.resumeCount > m.jdCount * 3);
  const skillsSec = resume.sections.find((s) => s.key === "skills");
  const skillItems = skillsSec ? skillsSec.lines.join(",").split(/[,|•;]/).filter((x) => x.trim()).length : 0;
  const dump = skillItems > 45;
  const problems = [...heavy.map((m) => `"${m.term}" ×${m.resumeCount}`), ...(dump ? [`${skillItems} items in Skills`] : [])];
  r.add(
    { id: "stuffing", label: "No keyword stuffing", status: problems.length ? "warn" : "pass", detail: problems.length ? problems.join(", ") : "Keyword density looks natural." },
    problems.length ? { severity: "medium", issue: `Possible keyword stuffing: ${problems.join(", ")}`, recommendation: "Mention each key skill 2-3 times where you used it. Over-repetition and giant skill lists read as gaming the ATS to the recruiter who reads it next." } : undefined,
    problems.length ? 4 : 0,
  );
  return r;
}

export function merge(...rs: CheckResult[]): CheckResult {
  return { checks: rs.flatMap((r) => r.checks), issues: rs.flatMap((r) => r.issues), deductions: rs.flatMap((r) => r.deductions) };
}

export type { Severity };
