# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-11

### Added
- **Business, consulting and operations keywords**: process simplification,
  standardisation, automation, RPA, business transformation, business case, governance,
  team management, process mining, consulting, GenAI; and **domain / industry** keywords
  (Finance, HR, Supply Chain, Insurance, Financial Services, Operations) as their own type,
  nice-to-have unless the JD states them as required. "Learning opportunities" sections
  count at nice-to-have weight.
- **Multi-word skills** read as one phrase ("Lean Six Sigma" is one keyword, not Lean +
  Six Sigma + a certification); the belt is a separate certification.
- **Related methods**: DMAIC, SIPOC, Pareto, 5-Why, control chart, CTQ and Kaizen give
  related credit to Lean Six Sigma; PM4Py, Celonis and event logs to Process Mining;
  UiPath and Power Automate to RPA.
- **Knockouts split** into hard knockouts (stated requirements) and "preferences you
  don't meet" (desirable or preferred items, never an automatic rejection). Only
  "required", "must", "mandatory", "minimum" wording or Requirements / Qualifications /
  Education headings can make a knockout.
- **Degree detail**: "MBA (Tier 1/Tier 2)" instead of "Master's degree"; PGPM, PGDM, PGP
  and PGDBA count as MBA-equivalent; a non-MBA master's against an MBA requirement is
  flagged.
- **Consulting ladders** for seniority (Analyst < Senior Analyst < Consultant < Associate
  Manager < Manager; Accenture CL levels), preferring the JD's explicit "Level:" field.
- **Campus placement mode**: a roll number + "Batch of" on the resume, or campus
  recruitment language in the JD, shows a notice and turns formatting and contact
  failures into warnings (scores unchanged); in-progress degrees get final-year advice.
- **Custom dictionary** (`src/lib/nlp/custom-words.json`) plus business and Indian
  English words (benchmarking, upskilling, rollout, lakh, crore); words next to an amount
  are never flagged.
- Every keyword row shows its match tier, resume evidence and the **JD line it came
  from**; a **self-check** line ends every report (totals reconcile, no keyword outside
  the JD, no contradicting checks).
- Advice-only findings: "no headline under your name", and academic projects that name a
  company system ("SAP log") without a data source.

### Changed
- Keyword summary counts, the Overview tiles, the tables and the report use one tally;
  soft skills are listed on their own (not scored).
- "Single-column layout" warns when tables or text boxes failed.
- Title match without a headline uses the latest job title and the summary's opening
  phrase, and says which it used.
- Evidence from Projects sections weighs 0.9x in recency (work experience 1.0–1.5x).
- JD mention counts ignore the About blurb and legal boilerplate; vaccination, anti-fraud,
  equal-opportunity and campus-committee notices never yield keywords.

### Fixed
- "GenAI" in a JD was reported as "Large Language Models".

## [1.0.0] - 2026-10-16

### Added
- **Match score** (0–100) for a resume (PDF, DOCX or text) against a job description:
  hard skills, experience and title alignment, section structure, formatting and parse
  health, bullet impact, plus advisory writing quality. General mode scores a resume
  with no job description.
- **Keyword evidence**: every match shows its tier (exact, alias, word form, semantic,
  related) and the resume line that proves it. Editable aliases in
  `src/lib/nlp/aliases.json`.
- **Knockout screen** (location, work authorization, clearance, certifications, years,
  degree, languages) with a confidence level per check and a parse-confidence verdict.
- **Parsing**: two-column PDFs read column by column, wrapped bullets and tables
  rebuilt, names from the largest text near the top; Word headers, footers, tables,
  text boxes and link targets.
- **ATS view** with a parse rate, findings grouped by root cause with capped penalties.
- **Auto-tailor** and **target-score slider** that keep the original layout, including
  in-place `.docx` edits; safe, substitution-only rewrite suggestions.
- **Report for Claude** (Markdown), with an optional keep-layout mode.
- **Command line** (`npm run ats`) with `--show-extracted`, `--keep-layout`, `--report`
  and `--json`.
- Windows launchers: `Start ATS Analyzer.cmd` and `Stop ATS Analyzer.cmd`.
- Requires **Node.js 22 or newer** (the bundled PDF engine uses `ArrayBuffer.transferToFixedLength`; Node 20 is end-of-life).

### Security
- The server binds to **127.0.0.1** only, and API routes refuse cross-site requests.
- Security headers on every response (CSP, `X-Frame-Options`, `nosniff`,
  `Referrer-Policy`).
- Zip-bomb guard for `.docx` uploads; client-supplied regular expressions are checked
  for catastrophic backtracking.
- Next.js upgraded to **15.5.28** (fixes the critical React Server Components and
  Image Optimization advisories); `postcss` and `sharp` pinned to patched versions;
  the unused `mammoth` dependency removed.

[1.1.0]: https://github.com/pushpankar-kiran/resumefit/releases/tag/v1.1.0
[1.0.0]: https://github.com/pushpankar-kiran/resumefit/releases/tag/v1.0.0
