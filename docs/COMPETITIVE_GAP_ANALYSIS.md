# Competitive gap analysis: ATS Resume Analyzer vs. the market

Compiled 2026-10-13 from the public product and feature pages of 9 tools: Jobscan, Resume Worded, Enhancv, Teal, Rezi, SkillSyncer, Kickresume, Resume Genius and Careerflow. The Huntr page could not be fetched.

**Caveat:** this is based on what each vendor *advertises*, not on hands-on testing. "—" means the page didn't mention the feature, not that the product lacks it. Vendor outcome claims ("3x more interviews") are not evidence.

Legend: ✅ have it · 🟡 partial · ❌ missing · — not stated

## 1. Feature matrix

### Matching & scoring

| Feature | **Ours** | Jobscan | Resume Worded | Enhancv | Teal | Rezi | SkillSyncer | Kickresume | Resume Genius |
|---|---|---|---|---|---|---|---|---|---|
| Resume vs JD match score | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Missing hard / soft skill keywords | ✅ / 🟡 soft not scored | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Must-have vs nice-to-have weighting | ✅ | — | — | — | — | — | 🟡 by frequency | — | — |
| Keyword frequency (how often JD mentions it, count in resume) | ✅ up to 1.75x weight | ✅ | — | — | — | — | ✅ | — | — |
| Acronym and full-term matching | ✅ | ✅ | — | — | — | — | — | — | — |
| Advice to include **both** acronym and full term | ✅ | ✅ | — | — | — | — | — | — | — |
| Job title match | ✅ | ✅ | — | ✅ "tailored title" | — | — | — | — | — |
| Years-of-experience match | ✅ | ✅ | — | — | — | — | — | — | — |
| **Education level / degree match** | ✅ | ✅ (#2 in their score) | — | — | — | — | — | — | — |
| **Job-level / seniority match** | ✅ scored | ✅ | — | ✅ career progression | — | — | — | — | — |
| Score **without** a JD (general resume quality) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Detect which ATS the employer uses** (Workday, Greenhouse…) and tailor rules | ❌ | ✅ | — | 🟡 tests vs BambooHR/Greenhouse/Lever/SAP | — | — | — | 🟡 "simulator" | — |
| Benchmark against a database of successful resumes | ❌ | — | — | ✅ peer benchmarking | — | — | — | ✅ | ✅ |
| Over-optimization / keyword-stuffing warning | ✅ incl. hidden white text | ✅ | — | — | — | — | — | — | — |
| Transparent, explainable formula | ✅ **ahead** | 🟡 lists priorities | ❌ | 🟡 2-tier | ❌ | 🟡 per section | ❌ | 🟡 | ❌ |

### Formatting & parse checks

| Check | **Ours** | Jobscan | Enhancv | Resume Genius | Kickresume |
|---|---|---|---|---|---|
| Columns, tables, text boxes, images | ✅ | ✅ | ✅ | ✅ | ✅ |
| Contact info in header/footer | ✅ | ✅ | ✅ "header links" | — | — |
| Standard section headings | ✅ | ✅ | ✅ | — | — |
| Date-format consistency | ✅ | ✅ | ✅ | — | — |
| **"What the ATS sees" parsed view / parse rate %** | ✅ | — | ✅ | ✅ | ✅ |
| **Font type, size, colour; special characters; bold overuse** | ✅ | ✅ | ✅ "ATS-friendly design" | — | — |
| **Margins and page size** | ✅ | ✅ | — | — | — |
| **Reverse-chronological order** | ✅ | ✅ | — | — | — |
| **Section order** | ✅ | — | ✅ | — | — |
| **File name, size and type advice** (.docx often parses better) | ✅ | ✅ | ✅ | — | — |
| **Professional email address** | ✅ | — | ✅ | — | — |
| Links (LinkedIn, portfolio, GitHub) / web presence | ✅ | ✅ | ✅ | — | — |
| Word count / resume length | ✅ | ✅ | ✅ | — | — |
| Bullet length and consistency | 🟡 used in scoring, not flagged | — | ✅ | ✅ | — |

### Content quality (human-recruiter layer)

| Check | **Ours** | Jobscan | Resume Worded | Enhancv | SkillSyncer | Resume Genius |
|---|---|---|---|---|---|---|
| Action verbs, weak openers | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| Quantified results | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **Spelling & grammar** | ✅ offline | ✅ | — | ✅ | — | ✅ punctuation and capitalization |
| **Repeated words / phrases** | ✅ | ✅ | — | ✅ | — | — |
| **Buzzwords & clichés** | ✅ | ✅ | ✅ "vague" | — | ✅ filler words | — |
| **Tone** | ✅ | ✅ | — | — | — | — |
| **Employment gaps** | ❌ | — | — | ✅ | — | — |
| **Age / date bias** (very old dates) | ❌ | — | — | ✅ | — | — |
| **Career progression, leadership signals** | ❌ | — | — | ✅ | — | — |
| Skills listed but not evidenced in experience | 🟡 0.75x weight, not surfaced | — | — | ✅ "skills evidence" | — | — |
| **Credibility / interview-risk signals** | ❌ | — | — | ✅ | — | — |
| Flags pinned to the exact line, inline in the resume | 🟡 per-bullet list | — | ✅ | — | ✅ | — |

### AI writing

| Feature | **Ours** | Jobscan | Resume Worded | Teal | Rezi | SkillSyncer | Enhancv |
|---|---|---|---|---|---|---|---|
| Bullet rewriter | ✅ 3 options | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Keyword insertion into bullets | ✅ | ✅ AI Optimize | ✅ | ✅ | ✅ | ✅ | — |
| No invented metrics (placeholders) | ✅ **ahead** | — | 🟡 asks the user | — | — | 🟡 "your voice" | — |
| **One-click "fix everything" with per-change approval and diff** | 🟡 per-item apply plus diff; no batch | ✅ | ✅ AutoFix | — | ✅ AI agent | ✅ | — |
| **Clarifying questions to fill real metrics** ("how many reports?") | ❌ | — | ✅ | — | ✅ chat agent | — | — |
| **Summary generator** | ❌ | ✅ | — | ✅ | ✅ | — | 🟡 subtitle |
| **Tailored headline / title line** | ❌ | — | — | — | — | — | ✅ |
| **Cover letter generator** | ❌ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| **Bullet example library** | ❌ | — | ✅ 250+ | 🟡 900+ synonyms | — | — | — |

### Input / output

| Feature | **Ours** | Market |
|---|---|---|
| PDF, DOCX, TXT input | ✅ | ✅ everyone |
| **DOC, RTF, HTML, ODT input** | ❌ | Resume Genius takes DOC/DOCX/PDF/HTML/RTF/TXT |
| **OCR for scanned PDFs** | ❌ alert only | — (no one advertises it) |
| JD via paste or file | ✅ | ✅ |
| **JD via job URL / browser extension** | ❌ | Jobscan (URL), Rezi, Teal, Careerflow (Chrome extension) |
| PDF, Markdown, TXT export | ✅ | ✅ |
| **DOCX export** | ❌ | Resume Worded, SkillSyncer (premium) |
| **ATS-safe templates** | ❌ plain only | Jobscan, Teal (100+), Rezi, RW, Kickresume |
| **Letter/A4 and margin control on export** | ❌ | SkillSyncer |
| **Multi-language** | ❌ English only, warns otherwise | Kickresume, others |

### Platform & workflow

| Feature | **Ours** | Who has it |
|---|---|---|
| **Accounts, saved scans, score history** | ❌ stateless | everyone |
| **Multiple resume versions per job** | ❌ | Teal, Rezi, SkillSyncer |
| **Structured resume editor / builder** | ❌ text area only | Jobscan, Teal, Rezi, SkillSyncer, Enhancv, Kickresume |
| **LinkedIn import / LinkedIn profile optimization** | ❌ | Teal (import); Jobscan, RW, Careerflow (optimization) |
| **Job application tracker** | ❌ | Jobscan, Teal, SkillSyncer, Careerflow, Enhancv |
| **Job matching / job search** | ❌ | Jobscan, Rezi, Teal |
| **Auto-apply / form autofill** | ❌ | Jobscan, Careerflow |
| **AI interview practice** | ❌ | Jobscan, Rezi, Careerflow |
| **B2B / career-centre accounts** | ❌ | Jobscan, Enhancv, Careerflow |
| **Privacy promise (no training, delete anytime)** | 🟡 stateless, but no notice | RW, Enhancv, SkillSyncer state it |
| Re-score after edits | ✅ | Jobscan, RW, SkillSyncer |

## 2. Where we are already ahead

1. **Explainable scoring.** Every category shows its formula and inputs. Competitors present a black-box number.
2. **Honest rewrites.** Placeholders instead of invented metrics, and placeholders earn no score until they're filled in.
3. **Verified semantic credit.** Claude's equivalence claims only count if the phrase is really in the resume.
4. **Recency weighting and must/nice weighting**, which no competitor advertises.
5. **Layout forensics from real geometry** (column gutters, header bands), all in one free, local, no-signup tool with a JSON API.

> **Update (2026-10-14): all P0 items are built.** See section 4. The matrix above reflects the current state.

## 3. Prioritized gap list

**P0: gaps in the core scanner** (expected of any serious ATS checker; most can be built with what we have)
1. Education-level / degree match, added to the score.
2. Seniority / job-level match, scored. We already extract it.
3. Keyword frequency: JD mention count vs resume count, used to weight keywords.
4. Spelling & grammar (e.g. LanguageTool or the LLM path).
5. Repeated words, buzzwords/clichés, filler.
6. "What the ATS sees" panel: the parsed fields (name, contact, roles, dates, skills) and a parse-rate %.
7. Font, size, colour, special-character, margin and page-size checks. pdf.js already gives us font names and sizes.
8. Recommend acronym plus full term; flag keyword stuffing in the uploaded resume.
9. General resume score when no JD is given.
10. Reverse-chronological and section-order checks; file name/size/type advice; professional email; GitHub/portfolio links.

**P1: writing & output parity**
11. "Fix all" batch mode with per-change accept/reject, plus clarifying questions to gather real metrics.
12. Summary and headline generator tailored to the JD.
13. Cover letter generator.
14. DOCX export and 2–3 ATS-safe templates; Letter/A4 and margin options.
15. DOC/RTF/ODT/HTML input; OCR for scanned PDFs (e.g. tesseract.js).
16. Recruiter red flags: employment gaps, date bias, progression, unevidenced skills.
17. Job URL import for the JD.

**P2: platform (only if this becomes a product, not a tool)**
18. Accounts, scan history and resume versions; privacy notice and data deletion.
19. Specific-ATS detection and per-ATS rules (Workday, Greenhouse, Lever, iCIMS, Taleo).
20. Peer benchmarking (needs a corpus).
21. Chrome extension, job tracker, LinkedIn optimization, job matching, interview practice, auto-apply, B2B seats, multi-language.

## 4. P0 shipped (2026-10-14)

| # | Item | Where |
|---|---|---|
| 1 | Education / degree match, scored inside Experience Alignment | `src/lib/nlp/education.ts` |
| 2 | Seniority level match, scored inside Experience Alignment | `levelOfTitle` / `scoreSeniority` in `src/lib/scoring/engine.ts` |
| 3 | Keyword frequency: JD vs resume counts, 1x-1.75x weighting | `src/lib/nlp/matcher.ts` |
| 4 | Spelling (offline Hunspell) and rule-based grammar | `src/lib/nlp/writing.ts` |
| 5 | Repetition, buzzwords, filler and tone | `src/lib/nlp/writing.ts` |
| 6 | "What the ATS sees" tab with a parse-rate % and plain-text reading order | `src/lib/nlp/atsview.ts`, ATS View tab |
| 7 | Fonts, sizes, bold, colour, icon fonts, special characters, margins, page size, hidden text | `src/lib/parsers/pdf.ts`, `docx.ts`, `src/lib/nlp/checks.ts` |
| 8 | Acronym + full-term advice; keyword-stuffing detection | `src/lib/nlp/matcher.ts`, `src/lib/nlp/checks.ts` |
| 9 | General resume score when no JD is given | `analyze()` general mode |
| 10 | Chronology, section order, file name/size/type, professional email, GitHub/portfolio links, links hidden behind anchor text | `src/lib/nlp/checks.ts` |
