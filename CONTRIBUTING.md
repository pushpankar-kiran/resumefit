# Contributing

Thanks for your interest in improving ResumeFit! Contributions of all kinds are
welcome — bug reports, feature ideas, docs, and code.

## Ways to help

- 🐛 **Report a bug** — open a [bug report](../../issues/new?template=bug_report.yml). Include the file type, what you expected, and what happened. **Don't attach a real resume** — describe the layout or share a version with personal details replaced.
- 💡 **Suggest a feature** — open a [feature request](../../issues/new?template=feature_request.yml).
- 🔧 **Send a pull request** — see below.

## Development setup

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/pushpankar-kiran/resumefit.git
cd resumefit
npm install
npm run dev        # http://localhost:3221 with hot reload
npm test           # vitest suite
npm run typecheck
npm run build
```

Try a file from the command line and see exactly what was parsed:

```bash
npm run ats -- fixtures/resume-two-column.pdf --jd fixtures/dev-jd.txt --show-extracted
```

## Project layout

```
src/
  app/                 # Next.js pages and API routes (analyze, rewrite, tailor-docx, target-plan, health)
  components/          # dashboard tabs (overview, keywords, formatting, ATS view, rewrite, export)
  lib/
    parsers/           # pdf.ts (columns, tables, name), docx.ts (OOXML reader), text
    nlp/               # resume/JD structure, matcher + aliases.json, education, knockouts, writing
    scoring/           # category scores, root-cause findings
    tailor.ts          # auto-tailor plan; docx-edit.ts edits a .docx in place
    report.ts          # "report for Claude" Markdown
    security.ts        # same-origin checks, regex and zip-bomb guards
scripts/ats-cli.ts     # command line (npm run ats)
tests/                 # vitest; helpers/ builds synthetic PDFs and .docx files in memory
fixtures/              # sample resumes, JDs and the template lab
```

## Pull request guidelines

- Keep changes focused; one topic per PR.
- Match the existing code style (no linter is enforced — read the surrounding code).
- **Tests assert extracted facts** (names, sections, roles, evidence, findings), never
  score values. Add a regression test for every parsing or matching fix.
- **Never commit a real resume or personal data.** Build fixtures with the helpers in
  `tests/helpers/` using fictional people; tests that need your own files go in
  `tests/local/` (git-ignored).
- Don't tune scoring weights to raise a particular resume's score; scores should only
  change because parsing or matching became more accurate.
- New keyword synonyms belong in `src/lib/nlp/aliases.json`, not in code.
- Make sure `npm run typecheck`, `npm test` and `npm run build` pass (CI runs them too).
- Update `README.md` and `CHANGELOG.md` if your change is user-visible.

## Reporting security issues

Please **do not** open a public issue for security problems — see [SECURITY.md](SECURITY.md).
