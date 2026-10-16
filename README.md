<h1 align="center">ResumeFit — ATS Resume Analyzer</h1>

<p align="center">
  Score a resume (<b>PDF, Word or text</b>) against a job description the way an applicant tracking system reads it: keyword match <b>with evidence</b>, knockout screening, formatting and parse health, and layout-preserving tailoring. Runs <b>entirely on your machine</b>; no API key needed.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-2f6f62.svg"></a>
  <a href="../../actions/workflows/ci.yml"><img alt="CI" src="https://github.com/pushpankar-kiran/resumefit/actions/workflows/ci.yml/badge.svg"></a>
  <a href="../../actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/pushpankar-kiran/resumefit/actions/workflows/codeql.yml/badge.svg"></a>
  <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-1c211f.svg">
  <img alt="Runs locally" src="https://img.shields.io/badge/runs-100%25%20locally-2f6f62.svg">
</p>

Compares a resume (PDF, DOCX or TXT) against a job description. It returns a 0–100 match score, finds keyword gaps (showing the resume line that proves each match), flags formatting and parsing risks, screens knockout requirements, and helps you rewrite weak bullets without changing your layout.

Built with Next.js 15 (App Router), TypeScript, Tailwind, shadcn-style components, Radix Tabs, Framer Motion, Recharts and react-dropzone. Claude (Anthropic API) is **optional**: without a key, the whole pipeline runs on a built-in deterministic NLP engine.

## Features

- 📊 **Match score** across hard skills, experience, section structure, formatting and bullet impact, with every point explained
- 🔎 **Keyword evidence**: each match shows its tier (exact, alias, word form, semantic, related) and the resume line that proves it
- 🚦 **Knockout screen**: location, work authorization, clearance, certifications, years, degree and languages, each with a confidence level
- 🧾 **ATS view**: what a basic ATS keeps from your file, with a parse rate
- 📄 **Real-world parsing**: two-column PDFs, Word tables and text boxes, headers and footers, link targets
- ✍️ **Safe rewrites**: word substitutions only, never invented numbers, shown as old → new with the word-count change
- 🎯 **Auto-tailor and target-score slider** that keep your original layout (in-place .docx edits, no extra lines)
- 📋 **Report for Claude**: one Markdown file with every finding and a ready-made prompt (optional keep-layout mode)
- 💻 **Command line**: `npm run ats -- resume.pdf --jd jd.docx --show-extracted`
- 🔒 **Local-first**: bound to 127.0.0.1, no telemetry, no account

## Install

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/pushpankar-kiran/resumefit.git
cd resumefit
npm install
npm run build
npm start          # http://localhost:3221
```

## Usage

On Windows, double-click **Start ATS Analyzer.cmd** (it opens http://localhost:3221). Press Ctrl+C or close the window to stop it; if a window ever hangs, double-click **Stop ATS Analyzer.cmd**, which stops only the analyzer's server on port 3221.

```bash
npm install
npm run build && npm start      # http://localhost:3221
npm test                        # vitest suite: parsing, scoring, security, template lab, PDF/.docx parity
npm run ats -- resume.docx --jd jd.docx --show-extracted   # command-line analysis (see "Command line" below)
npm run build:templates         # regenerate the template lab PDFs (needs Chrome + Microsoft Word)
npm run calibrate               # compare scores with real outcomes / other tools (see calibration/)
```

**Runs fully locally by default**: no API key and no cost. Optional AI mode uses Anthropic API credits: copy `.env.example` to `.env.local` and set `ATS_AI=claude` (plus `ANTHROPIC_API_KEY` if it isn't already set on your machine). A machine-wide API key on its own does **not** turn AI on. `GET /api/health` reports which mode is active.

## How scoring works (100 points)

| Category | Weight | How it's computed |
|---|---|---|
| Hard Skills & Tools | 35 | JD keywords (hard skills, tools, certifications) weighted **must-have 2x / nice-to-have 1x**, times a **frequency weight** of 1x–1.75x for keywords the JD repeats. Credit per keyword, by match tier: exact, alias (`GCP` ↔ Google Cloud Platform; extra aliases in the editable `src/lib/nlp/aliases.json`: `synonyms` are two-way, `variants` are one-way, e.g. "user stories" → Requirements Gathering, with `prefix*` wildcards) and word-form (the same words in another inflection: prioritize / prioritizing / prioritization / prioritise) = 1.0; semantic (typos, derived or re-ordered phrases, or a Claude-judged equivalent checked against the resume text) = 0.8; related = 0.3, only for a sibling listed in the alias file's `related` groups (MySQL for PostgreSQL). **Evidence rule:** any match other than exact or an alias-file phrase needs one of the keyword's head words in that line ("time" for Time Management; generic words like "management" don't count), so "prioritizing" is not Time Management and "product strategy" is not Strategic Thinking. Matches never span two lines, a different real word never counts as a typo, and each match shows its tier and the resume line with the matched words in [brackets]. "Resume mentions" counts every credited occurrence (related siblings excepted) |
| Experience & Title Alignment | 25 | 30% title similarity against recent roles · 25% years of experience vs the JD (overlapping roles merged) · 15% **seniority level** (Intern → Director+, from title and years) · 15% **education / degree** vs the JD requirement (understands "or equivalent experience" and "preferred") · 15% recency-weighted keyword evidence (**1.5x** in the summary or 2 most recent roles, 1.0x in older roles, 0.75x if only in the Skills list). Components the JD doesn't specify drop out and the rest re-weight. |
| Section Structure | 15 | 4 core sections (Summary, Experience, Education, Skills): 25 points each with a standard heading, 12.5 with a non-standard one ("Where I've Been"), 0 if missing. Common synonyms count as standard (Profile Summary, Qualifications, Academic Projects, Awards, Positions of Responsibility). Contact details are checked under Formatting, not as a section. |
| Formatting & Parse Health | 15 | Starts at 100 and deducts for multi-column layouts, tables, text boxes, images, icon fonts, special symbols, **hidden (white) text**, contact details in headers/footers, missing email/phone/LinkedIn/name, unprofessional email, links hidden behind anchor text, mixed or unparseable dates, non-chronological roles, tiny fonts, unusual fonts, non-standard page size, cramped margins, files over 2 MB, keyword stuffing and length over 2 pages. Findings are **grouped by root cause** (layout, contact, dates, typography, integrity, file), so one problem is reported once with its symptoms listed, and each cause's penalty is capped (e.g. layout −25, contact −15) instead of stacking. |
| Bullet Impact | 10 | Share of bullets that open with a strong action verb (full marks at 80%) and that include a quantified metric (full marks at 60%), minus a penalty for weak openers like "Responsible for". |

Bands: 0–59 low (red), 60–74 moderate (yellow), 75–100 high (green).

**Writing Quality** (spelling, grammar, repetition, buzzwords, filler, tone) is shown as an advisory sixth score in match mode. Like Jobscan's recruiter tips, it doesn't change the match rate. Spelling runs offline (Hunspell via `nspell`), so resume text never goes to a third-party grammar service.

**General mode.** Leave the job description empty to get a resume-quality score: Section Structure 25%, Formatting & Parse Health 30%, Bullet Impact 25%, Writing Quality 20%.

**ATS View.** The resume is re-parsed the way a basic ATS reads it: straight across the page, ignoring headers, footers, text boxes and hyperlinks. The tab shows the extracted profile, a **parse rate** (share of searchable fields that survive) and the plain-text reading order.

**Knockout screen.** These are the yes/no filters employers' ATS apply through application-form questions before anything gets ranked:

- location and on-site/remote arrangement
- work authorization and sponsorship, and citizenship
- security clearance
- required certifications and licenses
- minimum years of experience
- required degree
- required languages

Each check reports pass, borderline, likely knockout, "asked on the form", or **unable to verify** (the resume has relevant content the parser couldn't read reliably, e.g. an unrecognised degree or undated roles), plus a **confidence** level (high / medium / low). Each check's confidence can't exceed the **parse confidence** of the file (low for very little text, hidden text or a scrambled multi-column read; medium when content sits in tables, text boxes or headers). Parse confidence is also low when the name fails validation, an education section has no readable degree, or a contact detail could not be read; then the verdict is always "could not verify, check extracted text", never an auto-reject or all-clear. Only a confident fail counts as a likely knockout; a low-confidence fail becomes "could not verify". Every knockout row shows its confidence. A degree still in progress (future graduation year) is a medium-confidence borderline, and a "preferred" number of years is never a knockout. A likely knockout usually means automatic rejection whatever the match score, so knockouts are shown above the score rather than folded into it.

## How accurate is the score?

Employers' ATS mostly don't produce a 0–100 score. They parse the file, apply knockout filters, and let recruiters search, with some using proprietary AI ranking. So no tool can reproduce "the company's score". What this one tries to predict is:

1. whether you parse cleanly (ATS View, template lab), and
2. whether you'd surface in recruiter searches (keyword and experience match).

It also predicts 3. whether you'd be auto-rejected (knockouts).

- **Template lab:** `fixtures/templates/` holds the same resume in 10 common styles: 5 Chrome-printed HTML templates (Canva-style sidebar, LaTeX classic, skills grid, header contact, two-page footer) and 5 genuine Microsoft Word exports (classic, header contact, table layout, newspaper columns, text box), with expected results in `tests/templates.test.ts`.
- **Calibration:** the weights are a starting point. Use `calibration/` to compare against real interview outcomes or other tools' scores, and to fit better weights.

## Auto-tailor

In **Rewrite & Auto-tailor**, **Create tailored resume** applies the best safe fixes in one click and then re-scores the result. Each fix can be switched on or off before you run it:

- standard headings
- one date format
- stronger bullet openers (they never inflate your role: "Helped improve X" becomes "Collaborated to improve X", not "Improved X")
- confident spelling fixes, plus small grammar fixes and filler cuts
- acronym + full term
- optional [X%] result placeholders

You then see the before/after score and every change with a checkbox, and you can turn any change off and update. **Undo all** restores the original.

Missing keywords are added **only for skills you tick** as real experience: to Skills, and optionally to the best-matching bullet. Everything it deliberately doesn't automate is listed as a to-do: knockouts, untrue keywords, missing contact details, layout of the original file. The result opens in Export for PDF/Markdown/TXT download.

**Target score slider.** At the top of Auto-tailor, drag to the score you want. The app measures, by actually re-scoring, how much each honest change is worth: automatic fixes first, then missing skills you confirm you have. It shows the fewest changes that reach the target, with the projected score after each. Targets above the honest maximum are shown as unreachable, never filled with invented content. Projections for Word/PDF uploads add the measured gain to your file's own score, so layout penalties the in-place edit keeps are still counted (`src/lib/target.ts`, `/api/target-plan`).

**Same format, no extra lines.** Every edit is checked against your layout. It is applied only if the new text is no wider than the original, or the line is short enough to fit on one line even with a pessimistic chars-per-line figure taken from your page width, margins and font size (Word) or your real line lengths (PDF). If the resume uses tables, columns or text boxes, line widths are unknowable, so edits there may never grow. Anything that doesn't fit is held back and shown with the reason. No bullets, lines or sections are ever added.

- **Word (.docx) uploads:** **Download tailored .docx** edits your own file in place, keeping every font, bold run, bullet, table, header and margin. Checked with Microsoft Word on four resumes (including a two-column, table-based one): the same page count and every printed line in the same position (`scripts/word-roundtrip.mts` + `scripts/compare-layout.mjs`).
- **PDF uploads:** a PDF can't be safely rewritten in place (its embedded fonts usually only contain the letters already used), so you get a change list to apply in your source file, or you can upload the .docx it came from.
- **Text:** a tailored .txt, line for line.

## Command line

`npm run ats -- <resume.docx|pdf|txt> [--jd <file or text>] [--show-extracted] [--keep-layout] [--report out.md] [--json]` runs the built-in engine (no API credits) and prints the score, name, contact states, highest degree, skills count, margins and their source, the knockout verdict with confidence, every keyword with its match tier and evidence, and the grouped findings.

- `--show-extracted` prints the detected sections, the parsed roles with dates and bullets, the education rows, and the parsed fields side by side with what a basic ATS keeps (name, email, phone, LinkedIn, every education entry, skills, roles, parse confidence), then the raw text the analyzer read (body, tables, text boxes, headers, footers), the plain read a basic ATS sees (body only), header/footer text, hyperlink targets, the name hint and the margin source, so you can check the parse yourself.
- `--keep-layout` (with `--report`) writes a report whose prompt asks Claude for a diff-only list of word swaps: no single-column restructure, no new lines, and the word count must not increase. The same option is the **Keep my layout** checkbox next to the report buttons in the app.

## Report for Claude

After an analysis, **Copy report for Claude** (top of the results, and in the Export tab) produces one Markdown report. **Download report (.md)** saves the same report as a file. It contains:

- a ready-made prompt, which tells the assistant to keep everything true, add keywords only where they fit, use [placeholders] for missing numbers, and reply with a revised resume, a change log and questions;
- the score breakdown and knockout screen;
- keyword gaps with JD vs resume counts;
- formatting, writing and bullet findings;
- the full job description and resume.

Paste it into Claude (or any assistant) to get a revised resume. Example: `fixtures/sample-claude-report.md`.

## Parsing

- **PDF** (`unpdf` / pdf.js): reads positioned text items, which lets it find:
  - **two-column layouts** from word positions: for each candidate gutter x, the longest vertical run of lines that no word crosses, with real text on both sides, is a column region. Full-width bands above and below (header, summary, a full-width table) are read separately; inside a region the left column is read top to bottom, then the right. The older whole-page gutter test remains as a fallback, and skills grids (one- or two-word cells) stay single-column;
  - wrapped bullets (continuation lines indented past the bullet glyph) and two-line headings ("POSITIONS OF / RESPONSIBILITY") are re-joined, and tables whose cells wrap are rebuilt row by row as "cell | cell | cell" from the header's column positions;
  - the name: the largest-font run in the top 20% of page one that passes the name check (it may share a row with "Experience: 75 Months");
  - headers and footers, both by position and by the tagged-PDF "Artifact" marks Word and Google Docs add;
  - fonts, sizes and colours, white or invisible text, where each image is drawn (a single header-band logo clear of text is a low finding), and link annotations including `mailto:`/`tel:`;
  - margins from the content bounding box of the words (PDFs store no margin setting).

  Image-only scans are rejected with an OCR alert.
- **DOCX** (raw OOXML via `jszip`, own reader): reads only `w:t` text runs, so drawing anchors (`wp:posOffset`, `pctWidth`) never leak in as numbers. For `mc:AlternateContent` it reads the `Choice` only (the `Fallback` is a duplicate copy), descends into `w:txbxContent` text boxes, reads simple table rows as `a | b | c` lines, and reads headers and footers. Hyperlink targets (`mailto:`, `tel:`, LinkedIn, portfolio) come from every part's `.rels` file, including the header's. It also detects `w:cols` columns, tables, images, fonts and margins.
- **TXT** or pasted text: structural section mapping only.
- **Name:** the largest/boldest short line near the top of a .docx (headers and table cells included) is used as a hint; otherwise the first 2–4 capitalised words above the first section heading that aren't a heading, a skill phrase ("PROJECT MANAGEMENT") or a label (Age, Gender, Experience). Nothing below the first heading is ever taken, so editing Key Skills can't change it. The Name check fails if the value is a heading, a skill, a JD keyword or a single word.
- **Contact details** are searched in the body, tables, text boxes, header, footer and hyperlink targets (`mailto:`, `tel:`, linkedin.com in the `.rels` files). Each is reported as found, hard to read (only in a header/footer, table, text box or link), could not read (e.g. "Email:" with no address) or absent. "Contact info in body" fails when there's no email or phone anywhere, and a "Portfolio"/"Website" link counts as web presence.
- **Margins** come from every section's `w:sectPr`/`w:pgMar` (never table indents), with the source shown; confidence is low if sections disagree. PDF margins are measured from text positions.
- **Sections** get a conventional name (Summary, Work Experience, Skills, Education, Projects, Awards, Leadership, Interests, Languages…); "Languages Known" and "Academic Projects/Training" are recognised.
- **Roles vs stated experience:** when the resume states more experience ("Experience: 75 months") than its dated roles add up to (by over 6 months), the report says "could not parse all roles", seniority uses the stated total, and parse confidence drops to low.
- **Parse confidence** (high/medium/low) covers columns (medium when they had to be separated), roles vs stated years, name, education and contact. When low, the knockout verdict is "could not verify, check extracted text" and a warning says scores may reflect layout rather than content.
- **Education:** one shared parser feeds the score, the knockout screen and the ATS view. A degree dictionary (PGPM, PGDM, MBA, B.Tech, B.E., M.Sc, 12th/10th…) gives each entry a level; the highest comes first, and a future graduation year marks it in progress.
- **Job descriptions:** URLs, emails, About/Disclaimer/location sections and department lists ("teams across Technology, Procurement, Information Security…") are ignored before keyword extraction. Must-have vs nice-to-have is decided per section and per clause ("Preference:", "is a plus", "preferably" = nice-to-have), and the degree requirement is read from the `Education:` line.
- File type is detected from magic bytes, not the extension. Legacy `.doc`, images, encrypted PDFs, empty files and files over 5 MB get specific errors.

## API

`POST /api/analyze` (multipart): `resume` (file) or `resumeText`, plus optional `jd` (text) or `jdFile` (omit both for general mode), and `useLLM=true|false`. It returns an `AnalysisResult` (`src/lib/types.ts`), which is a superset of the documented shape: `overallScore`, `categoryScores`, `keywords.{matched, missingMustHave, missingNiceToHave}`, `formattingIssues[{severity, issue, recommendation}]` and `bulletPointImprovements[{original, suggested}]`. It also includes per-keyword match details, diagnostics, keyword placements, a bullet audit and score explanations.

`POST /api/rewrite` (JSON): `{ bullet, missingKeywords, targetTitle }` returns 3 options.

## Guardrails

- Every suggested rewrite is shown as old → new word swaps with its word-count change, and any suggestion (built-in or Claude's) that appends a clause, adds more than a short insertion, or puts a placeholder on a numbered or alignment/risk bullet is dropped. Rewrites **never invent numbers and never append a clause**: they only substitute words (a stronger opener, a keyword for a same-meaning phrase, or `[N]` for a vague word like "several"). A bullet that already has a number (including "from 1 hour to 5 minutes", "4-member", "two engineers") never gets a placeholder, and alignment, coordination, escalation, risk and governance bullets are marked "metric optional". The Export tab warns until placeholders are filled in, and unfilled ones don't count as metrics when you re-score.
- Keyword suggestions add at most one new keyword per bullet, and only by **substituting words** (a same-meaning phrase, "pipelines" → "data pipelines", "dashboards" → "Tableau dashboards"), never by appending a clause like ", supporting X". If no substitution fits, the suggestion is to list the skill under Skills.
- Spelling never flags the JD's own words, common tool/brand names (Esports, Netlify, Confluence, Jira, Odoo…) or British spellings (optimised, programme).
- Claude's "semantic equivalent" claims only earn credit when the quoted phrase really appears in the resume.
- Resume and JD text are sent to Claude as tagged, untrusted data. Refusals, truncation and API errors fall back to the built-in engine, and the dashboard notes the fallback.
- Non-English JDs or resumes, garbled text encodings, and JDs that are too short or too long are all detected and reported.

## Layout

```
src/lib/parsers/   pdf.ts, docx.ts, index.ts (sniffing, sanitizing, errors)
src/lib/nlp/       skills taxonomy, term matching, JD + resume structure, dates, verbs, suggestions
src/lib/scoring/   engine.ts (the 5 weighted categories)
src/lib/ai/        claude.ts (structured outputs via zod)
src/lib/analyze.ts orchestration
src/components/    InputPanel, Overview (gauge/radar/cards), KeywordMatrix, FormattingAudit, RewriteStudio, ExportPanel
fixtures/          test resumes (single-column, two-column + header contact, white-text, scanned PDFs; risky DOCX)
docs/              COMPETITIVE_GAP_ANALYSIS.md
```

## Honest limitations

- **No tool can reproduce "the company's score".** Most employer ATS parse, filter and let recruiters search; this app predicts how cleanly you parse, whether you'd surface in searches, and whether you'd hit a knockout.
- **Keyword matching is tuned for English** and for the skills in its taxonomy plus `src/lib/nlp/aliases.json`. Unusual skills need an alias entry.
- **Scanned (image-only) PDFs** are rejected; there's no OCR.
- **PDF layout detection is heuristic.** Two-column pages are detected from word positions; unusual layouts can still read out of order. Use `--show-extracted` (or the ATS View tab) to check the parse, and look at the parse-confidence level.
- **PDFs can't be edited in place**; you get a change list instead of a tailored file.

## Privacy

Everything runs on your machine. The server listens on 127.0.0.1 only, keeps no files after a request, and sends nothing anywhere. The one exception is optional AI mode (`ATS_AI=claude` in `.env.local`), which sends the resume and job description to the Anthropic API. It's off by default.

## Development

```bash
npm run dev          # hot reload on http://localhost:3221
npm test             # vitest suite (parsing, scoring, security, PDF/.docx parity)
npm run typecheck
npm run build
```

Tests assert extracted facts (names, sections, roles, evidence), never score values. Tests that read your own resume files belong in `tests/local/`, which git ignores.

## Contributing

Contributions are welcome — bug reports, feature ideas, docs, and code. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See [SECURITY.md](SECURITY.md).

## Support the project

If this saved you some time, please **⭐ star the repo** — it helps other people find it. Bug reports and PRs are just as appreciated.

## License

[MIT](LICENSE) © Pushpankar Kiran
