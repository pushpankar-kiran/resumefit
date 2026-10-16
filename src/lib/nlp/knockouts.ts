import type { KeywordMatch, KnockoutCheck, KnockoutReport, ParsedDocument, ParsedResume, StructuredJD } from "../types";
import { resumeEducation, LEVEL_LABEL } from "./education";
import { escapeRegex, findTerm } from "./text";

// Knockout screening: the yes/no filters employers' ATS (Workday, Greenhouse, Lever, iCIMS...)
// apply through application-form questions before anyone ranks resumes. Failing one usually
// means automatic rejection regardless of keyword match, so these are reported separately
// from the 0-100 score.

const US_STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
const COUNTRIES: [RegExp, string][] = [
  [/\b(united states|u\.?s\.?a?\.?|usa|us-based|u\.s\.-based)\b/i, "United States"],
  [/\b(united kingdom|u\.?k\.?|england|britain)\b/i, "United Kingdom"],
  [/\bcanad(a|ian)\b/i, "Canada"],
  [/\bindia\b/i, "India"],
  [/\b(germany|german)\b/i, "Germany"],
  [/\baustralia\b/i, "Australia"],
  [/\bsingapore\b/i, "Singapore"],
  [/\b(european union|\beu\b|europe)\b/i, "EU"],
  [/\b(uae|united arab emirates|dubai)\b/i, "UAE"],
  [/\bireland\b/i, "Ireland"],
  [/\bnetherlands\b/i, "Netherlands"],
];
const INDIAN_CITIES = /\b(bengaluru|bangalore|mumbai|delhi|new delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi|chandigarh|indore|coimbatore|thiruvananthapuram)\b/i;

function countryOf(location: string | null): string | null {
  if (!location) return null;
  const st = location.match(/,\s?([A-Z]{2})\b/)?.[1];
  if (st && US_STATES.includes(st)) return "United States";
  if (INDIAN_CITIES.test(location)) return "India";
  for (const [re, name] of COUNTRIES) if (re.test(location)) return name;
  return null;
}

/** The JD sentence/line matching `re`, without bullets. Splits after "word." but not inside "U.S." */
function sentenceWith(jd: string, re: RegExp): string | null {
  const s = jd.split(/\n|(?<=[a-z]{2}[.;])\s+(?=[A-Z])/).find((x) => re.test(x));
  return s ? s.replace(/^\s*(?:[-*•▪●]|\d+[.)])\s*/, "").trim().slice(0, 200) : null;
}

// ---------- Location & work arrangement ----------

function locationCheck(jd: string, resume: ParsedResume): KnockoutCheck | null {
  const text = resume.text;
  const remote = /\b(fully remote|100% remote|remote[- ]first|remote position|remote role|work from anywhere|remote \(|remote,|\bremote\b)/i.test(jd);
  const onsite = /\b(on[- ]?site|in[- ]office|in the office|hybrid|\d days? (a|per) week in)\b/i.test(jd);
  const cityM =
    jd.match(/(?:^|\n)\s*location\s*[:\-–]\s*([^\n]{2,60})/i)?.[1] ??
    jd.match(/(?:based in|located in|office in|on[- ]?site in|onsite in|hybrid in|in[- ]office in|must (?:live|reside|be located|be based) (?:in|within|near))\s+(?:the\s+)?([A-Z][A-Za-z.]+(?:[ ,/]+(?:[A-Z][A-Za-z.]+|[A-Z]{2}))*)/)?.[1] ??
    null;
  const regionM = jd.match(/remote\s*\(([^)]{2,40})\)|(?:must (?:reside|live|be located|be based) in|candidates (?:located|based) in|open to candidates in)\s+(?:the\s+)?([A-Za-z .]{2,40}?)(?=[.,;\n]|$)/i);
  const region = (regionM?.[1] ?? regionM?.[2])?.trim() ?? null;
  if (!remote && !onsite && !cityM && !region) return null;

  const loc = resume.contact.location;
  const relocate = /\b(open to relocat|willing to relocat|relocating to|relocation)\w*/i.test(text);
  const place = cityM?.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim() || null;
  const requirement = [remote && !onsite ? "Remote" : onsite ? "On-site / hybrid" : null, place, region].filter(Boolean).join(" · ");
  const base: Omit<KnockoutCheck, "status" | "advice" | "candidate"> = {
    id: "location",
    label: "Location / work arrangement",
    requirement,
    // Locations are free text; we read the country reliably, the city less so.
    confidence: resume.contact.location && countryOf(resume.contact.location) ? "high" : "medium",
  };

  if (!loc) {
    return { ...base, candidate: "No location on the resume", status: "unknown", advice: 'Add "City, State/Country" to your contact line. Many ATS filter or sort by location, and a missing one can drop you from recruiter searches.' };
  }
  const wantCountry = region ? countryOf(region) : cityM ? countryOf(cityM) : null;
  const haveCountry = countryOf(loc);
  if (remote && !onsite && !region) return { ...base, candidate: loc, status: "pass", advice: "Remote role with no stated location limit." };
  if (wantCountry && haveCountry && wantCountry !== haveCountry && wantCountry !== "EU") {
    return {
      ...base,
      candidate: loc,
      status: relocate ? "risk" : "fail",
      advice: relocate
        ? `The role is tied to ${wantCountry}; your resume says you're open to relocation, so confirm that on the application form.`
        : `The role is tied to ${wantCountry} and you're in ${haveCountry}. Location questions on the form are a common auto-reject; apply only if you can work there, and say so explicitly.`,
    };
  }
  if (onsite && cityM) {
    const city = cityM.split(/[,/]/)[0].trim().toLowerCase();
    const sameCity = city.length > 2 && loc.toLowerCase().includes(city);
    if (sameCity) return { ...base, candidate: loc, status: "pass", advice: "You're in the role's city." };
    if (wantCountry && haveCountry && wantCountry === haveCountry)
      return { ...base, candidate: loc, status: relocate ? "pass" : "risk", advice: relocate ? "Different city, but you've stated you're open to relocation." : `On-site/hybrid in ${place} while you're in ${loc}. Add "Open to relocation" to your summary if true.` };
    return { ...base, candidate: loc, status: "risk", advice: `On-site/hybrid in ${place}; your resume shows ${loc}. Mention relocation plans if you have them.` };
  }
  return { ...base, candidate: loc, status: "pass", advice: "No conflict found between the role's location and yours." };
}

// ---------- Work authorization / sponsorship ----------

function authorizationCheck(jd: string, resume: ParsedResume): KnockoutCheck | null {
  const noSponsor = /\b(no (visa )?sponsorship|not (be )?(able|offering) to sponsor|unable to sponsor|will not sponsor|cannot sponsor|does not sponsor|without (the )?(need for )?(visa )?sponsorship|sponsorship is not available)\b/i;
  const mustAuth = /\b(must be (legally )?(authorized|eligible) to work|work authori[sz]ation (is )?required|legally (authorized|eligible) to work|right to work in)\b/i;
  const citizen = /\b(u\.?s\.? citizen(ship)?( only| required)?|citizens? only|must be a citizen|citizenship (is )?required)\b/i;
  const jdNoSponsor = noSponsor.test(jd);
  const jdAuth = mustAuth.test(jd);
  const jdCitizen = citizen.test(jd);
  if (!jdNoSponsor && !jdAuth && !jdCitizen) return null;

  const t = resume.text;
  const needsVisa = /\b(requires? (visa )?sponsorship|need(s|ing)? (visa )?sponsorship|h-?1b|opt\b|stem opt|cpt\b|f-?1 (visa|student)|tn visa|l-?1 visa)\b/i.test(t);
  const isCitizen = /\b(u\.?s\.? citizen|citizen of the united states|indian citizen|uk citizen|canadian citizen|citizenship:)/i.test(t);
  const authorized = /\b(green card|permanent resident|authori[sz]ed to work|work authori[sz]ation|eligible to work|right to work|no sponsorship (required|needed)|ead\b)/i.test(t);
  const requirement = sentenceWith(jd, jdCitizen ? citizen : jdNoSponsor ? noSponsor : mustAuth) ?? "Work authorization required";
  // Read from free-text phrases, so never fully certain.
  const base = { id: "authorization", label: jdCitizen ? "Citizenship" : "Work authorization / sponsorship", requirement, confidence: "medium" as const };

  if (needsVisa && (jdNoSponsor || jdCitizen))
    return { ...base, candidate: "Resume mentions a visa / sponsorship need", status: "fail" as const, advice: "The employer says it won't sponsor. This question is a hard auto-reject on most application forms." };
  if (jdCitizen && !isCitizen)
    return { ...base, candidate: authorized ? "Work-authorized (citizenship not stated)" : "Not stated", status: "unknown" as const, advice: "Citizenship is required (often for clearance or government work). You'll be asked on the form; state it on the resume only if you meet it." };
  if (isCitizen || authorized) return { ...base, candidate: isCitizen ? "Citizenship stated" : "Work authorization stated", status: "pass" as const, advice: "Your resume states eligibility; answer the form question the same way." };
  return {
    ...base,
    candidate: "Not stated on the resume",
    status: "unknown" as const,
    advice: `You'll be asked this on the application form, and a "needs sponsorship" answer is an automatic reject here. If you're eligible, adding "Authorized to work in the ${/\bU\.?K\.?\b|united kingdom/i.test(requirement) ? "UK" : "US"}" to your contact line helps recruiters searching for it.`,
  };
}

// ---------- Security clearance ----------

function clearanceCheck(jd: string, resume: ParsedResume): KnockoutCheck | null {
  const re = /\b(active |current )?(top secret|ts\/sci|ts-sci|secret|public trust|sc|dv|nv1|nv2|baseline) (security )?clearance\b|\bclearance (is )?required\b|\bability to obtain (a )?(security )?clearance\b/i;
  if (!re.test(jd)) return null;
  const req = sentenceWith(jd, re) ?? "Security clearance";
  const active = /\b(active|current)\b/i.test(req) || /\bclearance (is )?required\b/i.test(req);
  const has = /\b(top secret|ts\/sci|ts-sci|secret|public trust)( security)? clearance\b|\bclearance:\s*\w+/i.test(resume.text);
  const base = { id: "clearance", label: "Security clearance", requirement: req, confidence: "high" as const };
  if (has) return { ...base, candidate: "Clearance mentioned", status: "pass" as const, advice: "Make sure the level and status (active/current) are written exactly." };
  return active
    ? { ...base, candidate: "Not mentioned", status: "fail" as const, advice: "An active clearance is required and your resume doesn't state one. If you hold it, add the level (e.g. \"Active TS/SCI\") near the top." }
    : { ...base, candidate: "Not mentioned", status: "risk" as const, advice: "You must be able to obtain a clearance (usually citizenship plus a background check). Note any clearance history on your resume." };
}

// ---------- Required certifications / licenses ----------

function certificationChecks(jd: string, matches: KeywordMatch[], resumeText: string): KnockoutCheck[] {
  const out: KnockoutCheck[] = [];
  for (const m of matches.filter((x) => x.category === "certification" && x.priority === "must")) {
    const sentence = sentenceWith(jd, new RegExp(m.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    const hard = !!sentence && /\b(required|must|mandatory|need to hold|active)\b/i.test(sentence);
    const ok = m.credit >= 0.8;
    out.push({
      id: `cert-${m.term}`,
      label: `Certification: ${m.term}`,
      requirement: sentence ?? `${m.term} (must-have)`,
      candidate: ok ? `Found${m.matchedAs && m.matchedAs !== m.term ? ` as "${m.matchedAs}"` : ""}` : "Not found",
      status: ok ? "pass" : hard ? "fail" : "risk",
      // Exact name found = sure; matched through an alias or other word form = fairly sure.
      confidence: ok ? (m.matchType === "exact" ? "high" : "medium") : m.matchType === "related" ? "low" : "high",
      advice: ok ? "Write the full name and acronym once, e.g. with the year earned." : hard ? `Listed as required. If you hold ${m.term}, add it to a Certifications section; if not, expect a screen-out question.` : `Listed as a must-have. Add ${m.term} if you hold it, or mention progress toward it.`,
    });
  }
  // Professional licenses that aren't in the skill taxonomy.
  const lic = jd.match(/\b(valid|active|current)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)*\s)?(license|licensure|licence)\b[^.\n]{0,60}/i);
  if (lic) {
    const what = lic[0].trim();
    const resumeHas = /\blicen[cs]e[ds]?\b/i.test(resumeText);
    out.push({
      id: "license",
      label: "Professional license",
      requirement: what,
      candidate: resumeHas ? "A license is mentioned" : "No license mentioned",
      status: resumeHas ? "unverifiable" : "risk",
      confidence: resumeHas ? "low" : "medium",
      advice: resumeHas ? `Check it's the one asked for ("${what}") and list its state/number.` : `The JD asks for "${what}". If you hold it, list it under Certifications.`,
    });
  }
  return out;
}

// ---------- Years, degree, languages ----------

/** "Experience: 75 months", "6+ years of experience" stated on the resume itself. */
export function statedExperienceYears(text: string): number | null {
  const top = text.slice(0, 1500);
  const m =
    top.match(/\bexperience\s*[:\-–]?\s*(\d+(?:\.\d+)?)\+?\s*(months?|mos?|years?|yrs?)\b/i) ??
    top.match(/\b(\d+(?:\.\d+)?)\+?\s*(years?|yrs?|months?)\s+(?:of\s+)?(?:\w+\s+)?experience\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return /^m/i.test(m[2]) ? Math.round((n / 12) * 10) / 10 : n;
}

function yearsCheck(jd: StructuredJD, resume: ParsedResume): KnockoutCheck | null {
  if (!jd.experienceYears) return null;
  const need = jd.experienceYears;
  const preferred = !!jd.experiencePreferred;
  const dated = resume.roles.filter((r) => r.dates);
  const undated = resume.roles.length - dated.length;
  const stated = statedExperienceYears(resume.text);
  const computed = resume.totalYears;
  const base = {
    id: "years",
    label: preferred ? "Preferred years of experience" : "Minimum years of experience",
    requirement: `${need}+ years${preferred ? " (preferred)" : ""}`,
  };

  if (!dated.length && stated === null) {
    return {
      ...base,
      candidate: resume.roles.length ? `${resume.roles.length} role(s) found, none with dates we could read` : "No dated roles found",
      status: "unverifiable",
      confidence: "low",
      advice: `We couldn't read your experience dates, so this can't be checked. Give every role a date range like "Mar 2020 – Present" so an ATS can count your years.`,
    };
  }
  // A stated total ("Experience: 75 months") covers history the dated roles may miss.
  const have = Math.max(computed, stated ?? 0);
  const confidence: KnockoutCheck["confidence"] = (stated !== null && Math.abs(stated - computed) > 1) || undated ? "medium" : "high";
  const raw = have >= need ? "pass" : have >= need - 1 ? "risk" : "fail";
  // A preferred number is never an auto-reject.
  const status = raw === "fail" && preferred ? "risk" : raw;
  const candidate =
    stated !== null && stated > computed
      ? `${stated} years (stated on your resume; dated roles add up to ${computed})`
      : `${have} years (from your dated roles${undated ? `; ${undated} undated role${undated > 1 ? "s" : ""} not counted` : ""})`;
  return {
    ...base,
    candidate,
    status,
    confidence,
    advice:
      status === "pass"
        ? stated !== null && stated > computed + 1
          ? "Meets it on your stated total, but an ATS counts dated roles. Make sure every role has dates so the two agree."
          : "Meets the stated number."
        : preferred
          ? "Below the preferred number, which isn't a hard filter. Lead with scope and results."
          : status === "risk"
            ? "Just under the minimum. Forms often ask \"Do you have N+ years?\"; count relevant internships or freelance work only if they're on the resume with dates."
            : "Well under the stated minimum, which many forms use as a knockout question. Add any missing dated roles, or target a more junior posting.",
  };
}

function degreeCheck(jd: StructuredJD, resume: ParsedResume): KnockoutCheck | null {
  const req = jd.education;
  if (!req || !req.required) return null;
  const entries = resumeEducation(resume);
  const requirement = `${req.label}${req.fields.length ? ` in ${req.fields.join(" / ")}` : ""}${req.equivalentExperienceOk ? " (or equivalent experience)" : ""}`;
  const base = { id: "degree", label: "Required degree", requirement };
  if (!entries.length) {
    const hasSection = resume.sections.some((s) => s.key === "education" && s.lines.some((l) => l.trim()));
    return hasSection
      ? {
          ...base,
          candidate: "Education section found, but no degree we recognise",
          status: "unverifiable",
          confidence: "low",
          advice: `We couldn't identify the degree in your Education section, and an ATS may not either. Write it in a standard form, e.g. "Master of Business Administration (MBA)" or "B.Tech. in Mechanical Engineering".`,
        }
      : {
          ...base,
          candidate: "No degree detected",
          status: req.equivalentExperienceOk ? "risk" : "fail",
          confidence: "medium",
          advice: req.equivalentExperienceOk
            ? "No degree found, but equivalent experience is accepted. Make your years and scope obvious."
            : "A required degree is a common knockout filter. Add an Education section that names the degree clearly.",
        };
  }
  // Highest completed degree, and the highest overall (which may still be in progress).
  const top = entries[0];
  const done = entries.find((e) => !e.inProgress);
  const name = (e: (typeof entries)[number]) => e.degree || LEVEL_LABEL[e.level];
  const label = (e: (typeof entries)[number]) => `${name(e)}${e.year ? ` (${e.inProgress ? `expected ${e.year}` : e.year})` : ""}`;
  if (done && done.level >= req.level)
    return { ...base, candidate: label(done), status: "pass", confidence: done.year ? "high" : "medium", advice: "Meets the degree requirement." };
  if (top.inProgress && top.level >= req.level)
    return {
      ...base,
      candidate: `${label(top)}, in progress`,
      status: "risk",
      confidence: "medium",
      advice: `Your ${name(top)} is still in progress. Forms often ask whether the degree is completed; keep "Expected ${top.year}" next to it and check whether the employer hires final-year candidates.`,
    };
  return {
    ...base,
    candidate: label(done ?? top),
    status: req.equivalentExperienceOk ? "risk" : "fail",
    confidence: "high",
    advice: req.equivalentExperienceOk
      ? "Below the stated degree, but equivalent experience is accepted. Make your years and scope obvious."
      : "A required degree is a common knockout filter. If you have it, make sure the Education section names the degree clearly (e.g. \"B.S. in Computer Science\").",
  };
}

const LANGS = "spanish french german mandarin chinese cantonese japanese korean portuguese italian dutch arabic hindi tamil telugu bengali marathi russian polish turkish vietnamese thai hebrew swedish".split(" ");

function languageChecks(jd: string, resume: ParsedResume): KnockoutCheck[] {
  const out: KnockoutCheck[] = [];
  const re = new RegExp(`\\b(fluent|fluency|proficient|proficiency|native|bilingual|business[- ]level|written and spoken)\\b[^.\\n]{0,40}\\b(${LANGS.join("|")})\\b|\\b(${LANGS.join("|")})\\b[^.\\n]{0,25}\\b(fluency|proficiency|speaking|required)\\b`, "gi");
  const seen = new Set<string>();
  for (const m of jd.matchAll(re)) {
    const lang = (m[2] ?? m[3]).toLowerCase();
    if (seen.has(lang)) continue;
    seen.add(lang);
    const langRe = new RegExp(`\\b${escapeRegex(lang)}\\b`, "i");
    const sentence = sentenceWith(jd, langRe) ?? m[0];
    const preferred = /\b(preferred|a plus|bonus|nice to have)\b/i.test(sentence);
    const has = findTerm(resume.text, lang).length > 0 || langRe.test(resume.text);
    out.push({
      id: `lang-${lang}`,
      label: `Language: ${lang[0].toUpperCase()}${lang.slice(1)}`,
      requirement: sentence,
      candidate: has ? "Mentioned on resume" : "Not mentioned",
      status: has ? "pass" : preferred ? "risk" : "fail",
      confidence: "high",
      advice: has ? "Add your level (e.g. \"Spanish: professional working proficiency\") so it's searchable." : `Add a Languages line if you speak ${lang[0].toUpperCase()}${lang.slice(1)}; language filters are common on these roles.`,
    });
  }
  return out;
}

export type Confidence = KnockoutCheck["confidence"];

/** One wording for the overall verdict, used by the dashboard, the report and the CLI. */
export const KNOCKOUT_VERDICT: Record<KnockoutReport["status"], string> = {
  "likely-reject": "likely auto-reject",
  unverified: "could not verify, check extracted text",
  review: "review before applying",
  clear: "clear",
};
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const lower = (a: Confidence, b: Confidence): Confidence => (RANK[a] <= RANK[b] ? a : b);

export const CHECK_EXTRACTED = "Could not verify: check the extracted text (ATS View tab, or --show-extracted on the command line).";

/**
 * How far the resume text itself can be trusted. Low when the file's text is thin or scrambled
 * (multi-column with a poor plain-text read, hidden text, very little text); medium when parts
 * sit in tables, text boxes or headers; otherwise high.
 */
export function parseConfidence(
  doc: Pick<ParsedDocument, "text" | "layout">,
  parseRate?: number,
  fields: { nameProblem?: string | null; educationUnreadable?: boolean; contactUnreadable?: string[]; rolesMissing?: string | null; columnsResolved?: boolean } = {},
): { level: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  const L = doc.layout;
  let level: Confidence = "high";
  if (doc.text.replace(/\s/g, "").length < 400) reasons.push("very little text could be extracted");
  // Field-level parse failures make the whole screen unverifiable.
  if (fields.nameProblem) reasons.push(`name: ${fields.nameProblem}`);
  if (fields.educationUnreadable) reasons.push("education: section found but no degree could be read");
  if (fields.contactUnreadable?.length) reasons.push(`contact: could not read ${fields.contactUnreadable.join(", ")}`);
  if (fields.rolesMissing) reasons.push(`experience: ${fields.rolesMissing}`);
  // A multi-column file whose columns we could NOT separate reads scrambled.
  if (L.columns > 1 && (parseRate ?? 100) < 60 && !fields.columnsResolved) reasons.push("multi-column layout scrambles the plain-text read");
  if (L.hiddenTextChars > 20) reasons.push("hidden (white/invisible) text");
  if (reasons.length) level = "low";
  else {
    if (L.columns > 1) reasons.push("two-column layout (read column by column)");
    if (L.hasTextBoxes) reasons.push("text boxes");
    if (L.hasTables) reasons.push("tables");
    if (L.headerFooterText) reasons.push("header/footer content");
    if (reasons.length) level = "medium";
  }
  return { level, reasons };
}

export function screenKnockouts(
  jdText: string,
  jd: StructuredJD,
  resume: ParsedResume,
  matches: KeywordMatch[],
  parse: { level: Confidence; reasons: string[] } = { level: "high", reasons: [] },
): KnockoutReport {
  const raw = [
    locationCheck(jdText, resume),
    authorizationCheck(jdText, resume),
    clearanceCheck(jdText, resume),
    ...certificationChecks(jdText, matches, resume.text),
    yearsCheck(jd, resume),
    degreeCheck(jd, resume),
    ...languageChecks(jdText, resume),
  ].filter((c): c is KnockoutCheck => !!c);
  // A check can't be more certain than the text it read. A low-confidence fail is never an
  // auto-reject verdict: it becomes "could not verify, check the extracted text".
  const checks = raw.map((c): KnockoutCheck => {
    const confidence = lower(c.confidence, parse.level);
    if (c.status === "fail" && confidence === "low")
      return { ...c, confidence, status: "unverifiable", advice: `${CHECK_EXTRACTED}${parse.reasons.length ? ` (${parse.reasons.join(", ")})` : ""} ${c.advice}` };
    if (c.status === "unverifiable" && !c.advice.includes("extracted text")) return { ...c, confidence, advice: `${CHECK_EXTRACTED} ${c.advice}` };
    return { ...c, confidence };
  });
  const fails = checks.filter((c) => c.status === "fail").length;
  const unverified = checks.filter((c) => c.status === "unverifiable").length;
  const risks = checks.filter((c) => c.status === "risk").length;
  return {
    // A low-confidence parse can never produce an auto-reject or an all-clear: it's unverified.
    status: parse.level === "low" && checks.length ? "unverified" : fails ? "likely-reject" : unverified ? "unverified" : risks ? "review" : "clear",
    parseConfidence: parse.level,
    summary: parse.level === "low" && checks.length
      ? `Could not verify: the resume text was parsed with low confidence (${parse.reasons.join("; ")}). Check the extracted text before trusting this screen.`
      : fails
      ? `${fails} likely knockout${fails > 1 ? "s" : ""}: an employer's ATS would probably auto-reject this application before ranking it.${unverified ? ` ${unverified} more could not be verified.` : ""}`
      : unverified
        ? `Could not verify ${unverified} requirement${unverified > 1 ? "s" : ""}: check the extracted text before trusting this screen.${risks ? ` ${risks} other possible knockout${risks > 1 ? "s" : ""} to check.` : ""}`
        : risks
          ? `${risks} possible knockout${risks > 1 ? "s" : ""} to check before applying.`
          : checks.length
            ? "No knockout risks found in the requirements we could check."
            : "The JD has no screening requirements we could check (location, authorization, clearance, certifications, years, degree, languages).",
    checks,
  };
}
