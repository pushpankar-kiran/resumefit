# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Security
- The server binds to **127.0.0.1** only, and API routes refuse cross-site requests.
- Security headers on every response (CSP, `X-Frame-Options`, `nosniff`,
  `Referrer-Policy`).
- Zip-bomb guard for `.docx` uploads; client-supplied regular expressions are checked
  for catastrophic backtracking.
- Next.js upgraded to **15.5.28** (fixes the critical React Server Components and
  Image Optimization advisories); `postcss` and `sharp` pinned to patched versions;
  the unused `mammoth` dependency removed.

[1.0.0]: https://github.com/pushpankar-kiran/resumefit/releases/tag/v1.0.0
