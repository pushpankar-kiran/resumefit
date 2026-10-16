// Shared schema for the ATS assessment. The API response (`AnalysisResult`) is a
// superset of the documented sample shape: overallScore, categoryScores, keywords,
// formattingIssues and bulletPointImprovements are always present with those names.

export type Severity = "high" | "medium" | "low";
export type KeywordCategory = "hard_skill" | "tool" | "certification" | "soft_skill";
export type Priority = "must" | "nice";
export type MatchType = "exact" | "alias" | "word-form" | "semantic" | "related" | "none";
export type SectionKey = "contact" | "summary" | "experience" | "education" | "skills";

// ---------- Parsing ----------

export interface FontUse {
  name: string;
  share: number;
}

export interface Typography {
  fonts: FontUse[];
  /** Most common font size (pt) by character count. */
  bodySize: number | null;
  minSize: number | null;
  boldShare: number;
  /** Share of characters in a non-black, non-grey colour. */
  coloredShare: number;
  iconFont: string | null;
}

export interface PageGeometry {
  width: number;
  height: number;
  /** Smallest margin seen on any page, in points (72pt = 1 inch). */
  margins: { top: number; right: number; bottom: number; left: number } | null;
  /** Where the margins came from, e.g. "w:pgMar in 1 section (w:sectPr)". */
  marginSource?: string;
  /** Low when sections disagree or no margin setting exists. */
  marginConfidence?: "high" | "medium" | "low";
  /** DOCX: each section's own margins, in points. */
  sectionMargins?: { top: number; right: number; bottom: number; left: number }[];
}

export interface LayoutSignals {
  /** Detected text columns on the busiest page (1 = single column). */
  columns: number;
  hasTables: boolean;
  hasTextBoxes: boolean;
  imageCount: number;
  /** Text found inside page header/footer zones (PDF) or header/footer parts (DOCX). */
  headerFooterText: string;
  pageCount: number;
  typography: Typography | null;
  page: PageGeometry | null;
  /** Characters rendered invisibly (white text, hidden runs): a keyword-stuffing red flag. */
  hiddenTextChars: number;
  /** PDF: where each image is drawn (points, origin bottom-left). */
  images?: { page: number; x: number; y: number; w: number; h: number; headerBand: boolean; overlapsText: boolean }[];
}

export interface ParsedDocument {
  fileType: "pdf" | "docx" | "txt";
  fileName: string;
  text: string;
  layout: LayoutSignals;
  /** Hyperlink targets found in the file (PDF link annotations, DOCX relationships). */
  links: string[];
  warnings: string[];
  /** Largest/boldest short line near the top of a .docx (usually the name), when there is one. */
  nameHint?: string | null;
  /** Text as a naive ATS reads it: straight across columns, headers/footers dropped. */
  naiveText: string;
  sizeBytes: number;
}

export interface ResumeSection {
  key: SectionKey | "other";
  heading: string;
  /** The section's conventional name: Summary, Work Experience, Skills, Projects, Awards... */
  canonical: string;
  /** True when the heading uses an ATS-standard label for its section. */
  standard: boolean;
  startLine: number;
  lines: string[];
}

export interface DateRange {
  raw: string;
  start: { year: number; month: number };
  end: { year: number; month: number } | "present";
  format: string;
}

export interface Role {
  title: string;
  company: string;
  dates: DateRange | null;
  bullets: string[];
  /** 0 = most recent. */
  index: number;
}

export type ContactField = "email" | "phone" | "linkedin";

/** Where a contact detail was found. "absent" and "could not read" are different findings. */
export interface ContactPresence {
  field: ContactField;
  /** found = plain text in the body; hard to read = only in a header/footer, table, text box or link target. */
  state: "found" | "hard to read" | "could not read" | "absent";
  where: "body" | "header/footer" | "table or text box" | "link target" | null;
  value: string | null;
  /** For "could not read": the text that suggests the detail is there (e.g. "Email:"). */
  clue?: string | null;
}

export interface ContactInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  location: string | null;
}

export interface ParsedResume {
  text: string;
  lines: string[];
  sections: ResumeSection[];
  contact: ContactInfo;
  roles: Role[];
  bullets: string[];
  summary: string;
  totalYears: number;
  dateFormats: string[];
  unparsedDates: string[];
}

// ---------- JD ----------

export interface JDKeyword {
  term: string;
  aliases: string[];
  category: KeywordCategory;
  priority: Priority;
}

export interface EducationRequirement {
  /** 1 high school, 2 associate, 3 bachelor's, 4 master's/MBA, 5 doctorate. */
  level: number;
  label: string;
  required: boolean;
  equivalentExperienceOk: boolean;
  fields: string[];
}

export interface StructuredJD {
  targetTitle: string;
  experienceYears: number | null;
  /** True when the years requirement sits in a "Preference"/nice-to-have section. */
  experiencePreferred?: boolean;
  seniority: string | null;
  education: EducationRequirement | null;
  keywords: JDKeyword[];
  responsibilities: string[];
  language: string;
  source: "ai" | "heuristic";
}

// ---------- Analysis ----------

export interface KeywordMatch {
  term: string;
  category: KeywordCategory;
  priority: Priority;
  matchType: MatchType;
  matchedAs: string | null;
  credit: number;
  jdCount: number;
  resumeCount: number;
  /** Multiplier from how often the JD repeats the keyword (1 to 1.75). */
  frequencyWeight: number;
  /** e.g. 'Write it as "Google Cloud Platform (GCP)"', when only one form is present. */
  acronymTip: string | null;
  /** Where the keyword was found: summary / recent role / older role / skills / other. */
  locations: string[];
  recencyBoosted: boolean;
  /** The resume line that proves the match (null when not found). */
  evidence?: string | null;
}

export interface FormattingIssue {
  id: string;
  severity: Severity;
  issue: string;
  recommendation: string;
  /** For a root-cause group: the individual findings it covers. */
  items?: FormattingIssue[];
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface BulletImprovement {
  original: string;
  suggested: string;
  reason?: string;
  /** The change as old → new word swaps (or a short insertion when `from` is empty). */
  swaps?: { from: string; to: string }[];
  /** Net word-count change (suggested minus original). */
  wordDelta?: number;
}

export interface KeywordPlacement {
  keyword: string;
  priority: Priority;
  targetBullet: string | null;
  section: string;
  suggestion: string;
}

export interface BulletAudit {
  text: string;
  role: string;
  strongVerb: boolean;
  weakPhrase: string | null;
  hasMetric: boolean;
  /** Alignment / risk / governance work: no metric is suggested. Advice only, not scored. */
  metricOptional?: boolean;
  score: number;
}

export interface CategoryScores {
  /** null in general mode (no job description). */
  hardSkills: number | null;
  experienceAlignment: number | null;
  sectionStructure: number;
  formattingHealth: number;
  bulletImpact: number;
}

export type WritingIssueKind = "spelling" | "grammar" | "repetition" | "buzzword" | "filler" | "tone";

export interface WritingIssue {
  kind: WritingIssueKind;
  text: string;
  message: string;
  suggestions: string[];
  /** The line the issue was found in, for context. */
  context: string;
  count?: number;
}

export interface WritingReport {
  score: number;
  tone: "professional" | "mixed" | "informal";
  issues: WritingIssue[];
  counts: Record<WritingIssueKind, number>;
  wordCount: number;
}

export interface AtsField {
  label: string;
  value: string | null;
  ok: boolean;
  note?: string;
}

export interface AtsView {
  parseRate: number;
  fields: AtsField[];
  sections: { heading: string; mappedTo: string; standard: boolean }[];
  roles: { title: string; company: string; dates: string | null; bullets: number }[];
  education: string[];
  skills: string[];
  naiveText: string;
  notes: string[];
}

export interface ScoreExplanation {
  label: string;
  value: string;
}

export interface AnalysisResult {
  /** "match" = scored against a JD; "general" = no JD, resume-quality score only. */
  mode: "match" | "general";
  overallScore: number;
  band: "low" | "moderate" | "high";
  categoryScores: CategoryScores;
  /** Points actually contributed to the 100-point total, per category. */
  weightedPoints: CategoryScores;
  /** Category weights used for this mode (sum to 100). */
  weights: Record<keyof CategoryScores | "writingQuality", number>;
  writing: WritingReport;
  atsView: AtsView;
  /** Yes/no screening filters (location, authorization, clearance, certs, years, degree, languages). null in general mode. */
  knockouts: KnockoutReport | null;
  /** Where each contact detail was found (or why not). */
  contactPresence?: ContactPresence[];
  /** How far the extracted text can be trusted (columns, roles vs stated years, name, education, contact). */
  parseConfidence?: { level: "high" | "medium" | "low"; reasons: string[] };
  keywords: {
    matched: string[];
    missingMustHave: string[];
    missingNiceToHave: string[];
    details: KeywordMatch[];
  };
  formattingIssues: FormattingIssue[];
  diagnostics: DiagnosticCheck[];
  bulletPointImprovements: BulletImprovement[];
  keywordPlacements: KeywordPlacement[];
  bulletAudit: BulletAudit[];
  explanations: Record<keyof CategoryScores | "writingQuality", ScoreExplanation[]>;
  jd: StructuredJD;
  /** The job description text as analyzed (empty in general mode). */
  jdText: string;
  resume: {
    fileName: string;
    fileType: string;
    text: string;
    contact: ContactInfo;
    sections: { key: string; heading: string; canonical: string; standard: boolean }[];
    roles: { title: string; company: string; dates: string | null }[];
    totalYears: number;
    education: { level: number; label: string; degree: string; detail: string; year: number | null; inProgress: boolean; status: "completed" | "in progress"; school: boolean }[];
    skills: string[];
    layout: LayoutSignals;
  };
  warnings: string[];
  engine: { llm: boolean; model: string | null; notes: string[] };
  generatedAt: string;
}

export interface KnockoutCheck {
  id: string;
  label: string;
  /** What the JD asks for (quoted or summarized). */
  requirement: string;
  /** What the resume shows. */
  candidate: string;
  /**
   * fail = likely auto-reject; risk = borderline; unknown = not on the resume, asked on the form;
   * unverifiable = the resume has relevant content we couldn't read reliably (check it yourself).
   */
  status: "pass" | "risk" | "fail" | "unknown" | "unverifiable";
  /** How sure the parser is about `candidate`. A low-confidence fail never counts as a knockout. */
  confidence: "high" | "medium" | "low";
  advice: string;
}

export interface KnockoutReport {
  /** unverified = no confident fail, but some requirement couldn't be checked from the text. */
  status: "clear" | "review" | "unverified" | "likely-reject";
  /** How far the extracted resume text can be trusted for these checks. */
  parseConfidence?: "high" | "medium" | "low";
  summary: string;
  checks: KnockoutCheck[];
}
