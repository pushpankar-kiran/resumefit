import type { AnalysisResult, BulletImprovement, DiagnosticCheck, KeywordMatch, KeywordPlacement, ParsedDocument, StructuredJD } from "./types";
import { nameProblem, parseResume } from "./nlp/resume";
import { dedupe, structureJDHeuristic } from "./nlp/jd";
import { matchKeywords } from "./nlp/matcher";
import { detectLanguage } from "./nlp/language";
import { findTerm } from "./nlp/text";
import { heuristicImprovements, heuristicPlacements } from "./nlp/suggest";
import { analyzeWriting } from "./nlp/writing";
import { resumeEducation } from "./nlp/education";
import { buildAtsView, skillsIn } from "./nlp/atsview";
import { parseConfidence, screenKnockouts } from "./nlp/knockouts";
import {
  characterChecks,
  chronologyChecks,
  contactQualityChecks,
  fileChecks,
  merge,
  pageChecks,
  sectionOrderChecks,
  stuffingChecks,
  typographyChecks,
} from "./nlp/checks";
import {
  auditBullets,
  band,
  overall,
  scoreExperience,
  scoreFormatting,
  scoreHardSkills,
  experienceCoverage,
  scoreImpact,
  scoreStructure,
} from "./scoring/engine";
import { groupFindings } from "./scoring/findings";
import { contactPresence } from "./nlp/contact";
import { unsafeSuggestion, wordDelta, wordSwaps } from "./nlp/swaps";
import { LlmError, MODEL, llmEnabled, structureJDWithClaude, suggestWithClaude } from "./ai/claude";

/** Exact, alias and semantic matches count as "matched"; family-only matches stay in the gap list. */
const FULL = 0.8;

export class AnalysisError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AnalyzeOptions {
  useLLM?: boolean;
}

/**
 * Score a resume. With a job description this is a match analysis (the 35/25/15/15/10
 * formula); without one it's a general resume-quality score (structure, formatting,
 * bullet impact and writing quality).
 */
export async function analyze(doc: ParsedDocument, jdText: string, opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const warnings = [...doc.warnings.map((w) => w.replace(/^[A-Z_]+:\s*/, ""))];
  const notes: string[] = [];

  // ---- Guardrails ----
  const scanned = doc.warnings.some((w) => w.startsWith("SCANNED_PDF"));
  const resumeChars = doc.text.replace(/\s/g, "").length;
  if (scanned && resumeChars < 200)
    throw new AnalysisError("SCANNED_PDF", "This PDF is an image-only scan, so no text could be extracted. ATS systems will see a blank resume. Export a text-based PDF from Word/Google Docs, or run OCR first.");
  if (resumeChars < 200) throw new AnalysisError("EMPTY_RESUME", "The resume contains too little readable text to analyze (under 200 characters).");
  const jdClean = jdText.replace(/\r\n?/g, "\n").trim();
  const mode: AnalysisResult["mode"] = jdClean ? "match" : "general";
  if (mode === "match" && jdClean.replace(/\s/g, "").length < 120)
    throw new AnalysisError("JD_TOO_SHORT", "The job description is too short. Paste the full posting, including requirements, or leave it empty for a general resume score.");
  if (jdClean.length > 30000) throw new AnalysisError("JD_TOO_LONG", "The job description is over 30,000 characters. Paste only the posting itself.");
  const weird = (doc.text.match(/[^\p{L}\p{N}\p{P}\p{Zs}\n\t$%+#&|•●▪◦‣·<>=~^`@*/\\-]/gu) ?? []).length;
  if (weird / doc.text.length > 0.15) warnings.push("The extracted resume text contains many unusual symbols, which suggests custom fonts or encoding that ATS systems often garble.");

  const jdLang = detectLanguage(jdClean);
  const resumeLang = detectLanguage(doc.text);
  if (mode === "match" && jdLang.language !== "English" && jdLang.language !== "Unknown")
    warnings.push(`The job description looks like ${jdLang.language}. Keyword matching is tuned for English, so expect a lower-confidence score.`);
  if (resumeLang.language !== "English" && resumeLang.language !== "Unknown")
    warnings.push(`The resume looks like ${resumeLang.language}. Keyword matching and spell-checking are tuned for English.`);

  // ---- Parse ----
  const resume = parseResume(doc.text, doc.links, doc.nameHint ?? null);
  const useLLM = mode === "match" && (opts.useLLM ?? true) && llmEnabled();
  let aiDown = false; // a billing/auth/network failure skips the remaining AI calls

  // ---- JD structuring ----
  const heuristicJD = structureJDHeuristic(jdClean);
  let jd: StructuredJD = mode === "match" ? heuristicJD : { ...heuristicJD, targetTitle: "", keywords: [], responsibilities: [], education: null, experienceYears: null, seniority: null };
  if (useLLM && !aiDown) {
    try {
      const ai = await structureJDWithClaude(jdClean);
      // Model output is primary; taxonomy hits it missed are kept at their heuristic priority.
      const merged = dedupe([...ai.keywords, ...heuristicJD.keywords.filter((k) => !ai.keywords.some((a) => a.term.toLowerCase() === k.term.toLowerCase()))]);
      jd = {
        ...ai,
        targetTitle: ai.targetTitle || heuristicJD.targetTitle,
        experienceYears: ai.experienceYears ?? heuristicJD.experienceYears,
        education: heuristicJD.education,
        keywords: merged,
        language: jdLang.language,
        source: "ai",
      };
    } catch (e) {
      aiDown = e instanceof LlmError && e.fatal;
      notes.push(`AI mode unavailable: ${(e as Error).message}. Used the built-in engine instead.`);
    }
  }
  if (mode === "match" && !jd.keywords.length) warnings.push("No recognizable skills or tools were found in the job description, so the hard-skills score is neutral.");

  // ---- Matching (+ optional model-judged semantic equivalents) ----
  let matches: KeywordMatch[] = mode === "match" ? matchKeywords(jd.keywords, resume, {}, jdClean) : [];
  let aiSuggest: Awaited<ReturnType<typeof suggestWithClaude>> | null = null;
  if (useLLM && !aiDown) {
    try {
      aiSuggest = await suggestWithClaude({
        title: jd.targetTitle,
        responsibilities: jd.responsibilities,
        missing: matches.filter((m) => m.credit < FULL).map((m) => ({ term: m.term, priority: m.priority })),
        bullets: resume.bullets,
        resumeText: resume.text,
      });
      // Only accept equivalents whose phrase really occurs in the resume (no hallucinated credit).
      const eq: Record<string, string> = {};
      for (const e of aiSuggest.semanticEquivalents)
        if (e.resumePhrase.length >= 3 && findTerm(resume.text, e.resumePhrase).length) eq[e.keyword] = e.resumePhrase;
      if (Object.keys(eq).length) matches = matchKeywords(jd.keywords, resume, eq, jdClean);
    } catch (e) {
      notes.push(`AI suggestions unavailable: ${(e as Error).message}. Used the built-in suggestion engine.`);
    }
  }

  // ---- Writing quality & document checks ----
  // Every word the employer used is fair game on the resume, so JD vocabulary is never "misspelled".
  const writing = await analyzeWriting(resume, [...jd.keywords.flatMap((k) => [k.term, ...k.aliases]), ...(jdClean.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? [])], doc.fileType === "pdf");
  const extra = merge(
    typographyChecks(doc.layout, doc.fileType),
    pageChecks(doc.layout),
    characterChecks(doc.text, doc.layout),
    fileChecks(doc, resume.contact.name),
    contactQualityChecks(resume, doc.links, jd.targetTitle),
    chronologyChecks(resume),
    sectionOrderChecks(resume),
    ...(mode === "match" ? [stuffingChecks(resume, matches)] : []),
  );

  // ---- Scoring ----
  const hs = mode === "match" ? scoreHardSkills(matches) : null;
  const ex = mode === "match" ? scoreExperience(jd, resume, matches) : null;
  const st = scoreStructure(resume);
  const presence = contactPresence(doc, resume);
  const fm = scoreFormatting(resume, doc.layout, doc.fileType, extra, writing.wordCount, presence, jd.keywords.map((k) => k.term));
  if (scanned) fm.score = Math.min(fm.score, 10);
  const audit = auditBullets(resume);
  const im = scoreImpact(audit);
  const categoryScores = {
    hardSkills: hs?.score ?? null,
    experienceAlignment: ex?.score ?? null,
    sectionStructure: st.score,
    formattingHealth: fm.score,
    bulletImpact: im.score,
  };
  const { overall: overallScore, weighted, weights } = overall(categoryScores, writing.score);

  // ---- Suggestions ----
  const missingTerms = matches.filter((m) => m.credit < FULL).map((m) => m.term);
  let placements: KeywordPlacement[] = mode === "match" ? heuristicPlacements(matches, resume.bullets, jd) : [];
  let improvements: BulletImprovement[] = heuristicImprovements(audit, missingTerms, jd);
  if (aiSuggest) {
    const stillMissing = new Set(missingTerms.map((t) => t.toLowerCase()));
    const ai = aiSuggest.placements
      .filter((p) => stillMissing.has(p.keyword.toLowerCase()))
      .map((p) => ({
        keyword: matches.find((m) => m.term.toLowerCase() === p.keyword.toLowerCase())?.term ?? p.keyword,
        priority: matches.find((m) => m.term.toLowerCase() === p.keyword.toLowerCase())?.priority ?? ("nice" as const),
        targetBullet: p.bulletIndex >= 0 ? (resume.bullets[p.bulletIndex] ?? null) : null,
        section: p.bulletIndex >= 0 ? "Experience" : p.section || "Skills",
        suggestion: p.suggestion,
      }));
    if (ai.length) placements = ai;
    const aiImp = aiSuggest.improvements
      .filter((i) => resume.bullets[i.bulletIndex])
      .map((i) => ({ original: resume.bullets[i.bulletIndex], suggested: i.suggested, reason: i.reason }));
    if (aiImp.length) improvements = aiImp;
  }
  // Every suggestion, built-in or Claude's, must be substitutions only: unsafe ones (appended
  // clauses, placeholders on numbered or alignment/risk bullets) are dropped. Each is shown as
  // old → new swaps with its word-count change.
  improvements = improvements
    .filter((i) => !unsafeSuggestion(i.original, i.suggested))
    .map((i) => ({ ...i, swaps: wordSwaps(i.original, i.suggested), wordDelta: wordDelta(i.original, i.suggested) }));

  // Role-count check: dated roles vs the experience the resume states.
  const cov = experienceCoverage(resume);
  const rolesCheck: DiagnosticCheck = {
    id: "section-roles",
    label: "All roles parsed",
    status: cov.missingRoles || !cov.roles ? "warn" : "pass",
    detail: `${cov.roles} dated role${cov.roles === 1 ? "" : "s"} parsed (${cov.parsed} yrs)${cov.stated !== null ? `; resume states ${cov.stated} yrs` : ""}${cov.missingRoles ? ". Could not parse all roles: check the extracted text." : "."}`,
  };
  if (cov.missingRoles) warnings.push(`Could not parse all roles: the resume states ${cov.stated} years of experience, but the dated roles add up to ${cov.parsed}. Seniority uses the stated total; check the extracted text.`);

  // One list grouped by root cause (formatting and structure can both report heading problems).
  const fmtIssues = groupFindings([...fm.issues, ...st.issues].flatMap((i) => i.items ?? [i])).issues;

  const atsView = buildAtsView(doc, resume);
  const parse = parseConfidence(doc, atsView.parseRate, {
    nameProblem: nameProblem(resume.contact.name, jd.keywords.map((k) => k.term)),
    educationUnreadable: resume.sections.some((s) => s.key === "education" && s.lines.some((l) => l.trim())) && !resumeEducation(resume).length,
    contactUnreadable: presence.filter((x) => x.state === "could not read").map((x) => x.field),
    rolesMissing: cov.missingRoles ? `could not parse all roles (${cov.roles} dated, ${cov.parsed} yrs vs ${cov.stated} yrs stated)` : null,
    // PDFs: the parser separates columns itself, so a scrambled plain read isn't our parse.
    columnsResolved: doc.fileType === "pdf" && doc.layout.columns > 1,
  });
  if (parse.level === "low")
    warnings.push(`Parse confidence is low (${parse.reasons.join("; ")}). Scores for this file may reflect layout rather than content: check the extracted text.`);
  const knockouts = mode === "match" ? screenKnockouts(jdClean, jd, resume, matches, parse) : null;
  const c = writing.counts;

  return {
    mode,
    overallScore,
    band: band(overallScore),
    categoryScores,
    weightedPoints: weighted,
    weights,
    writing,
    atsView,
    knockouts,
    contactPresence: presence,
    parseConfidence: parse,
    keywords: {
      matched: matches.filter((m) => m.credit >= FULL).map((m) => m.term),
      missingMustHave: matches.filter((m) => m.credit < FULL && m.priority === "must").map((m) => m.term),
      missingNiceToHave: matches.filter((m) => m.credit < FULL && m.priority === "nice").map((m) => m.term),
      details: matches,
    },
    formattingIssues: fmtIssues,
    diagnostics: [...fm.checks, ...st.checks, rolesCheck],
    bulletPointImprovements: improvements,
    keywordPlacements: placements,
    bulletAudit: audit,
    explanations: {
      hardSkills: hs?.why ?? [{ label: "General mode", value: "needs a job description" }],
      experienceAlignment: ex?.why ?? [{ label: "General mode", value: "needs a job description" }],
      sectionStructure: st.why,
      formattingHealth: fm.why,
      bulletImpact: im.why,
      writingQuality: [
        { label: "Spelling", value: `${c.spelling} possible error${c.spelling === 1 ? "" : "s"}` },
        { label: "Grammar & mechanics", value: `${c.grammar}` },
        { label: "Repetition", value: `${c.repetition}` },
        { label: "Buzzwords / filler", value: `${c.buzzword} / ${c.filler}` },
        { label: "Tone", value: writing.tone },
        { label: "In overall score", value: mode === "general" ? `${weights.writingQuality}%` : "advisory only (like Jobscan, not in the match rate)" },
      ],
    },
    jd,
    jdText: jdClean,
    resume: {
      fileName: doc.fileName,
      fileType: doc.fileType,
      text: resume.text,
      contact: resume.contact,
      sections: resume.sections.map((s) => ({ key: s.key, heading: s.heading, canonical: s.canonical, standard: s.standard })),
      roles: resume.roles.map((r) => ({ title: r.title, company: r.company, dates: r.dates?.raw ?? null })),
      totalYears: resume.totalYears,
      education: resumeEducation(resume),
      skills: skillsIn(resume.text),
      layout: doc.layout,
    },
    warnings,
    engine: { llm: useLLM && !notes.length, model: useLLM ? MODEL : null, notes },
    generatedAt: new Date().toISOString(),
  };
}
