# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/pushpankar-kiran/resumefit/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). You'll get a
response as soon as possible.

## Scope & threat model

ResumeFit is a **local** web app. It parses files **you** choose (resumes and job
descriptions) on your own machine. There is no hosted service, no account system and
no telemetry. By default it makes **no network calls**; the only exception is the
optional AI mode (`ATS_AI=claude` in `.env.local`), which sends the resume and job
description to the Anthropic API.

The inputs are untrusted documents, so the defences focus on parsing and on the local
server itself:

### Local server

- **Bound to 127.0.0.1 only** (`npm start`, `npm run dev` and the Windows launcher all
  pass `-H 127.0.0.1`), so other machines on your network can't reach it.
- **Cross-site requests are refused.** Every API route checks `Origin` /
  `Sec-Fetch-Site` (`src/lib/security.ts`), so a web page open in the same browser
  can't drive the analyzer or spend your Claude credits through `localhost`.
- **Security headers on every response** (`next.config.mjs`): a Content Security
  Policy with `default-src 'self'`, `connect-src 'self'`, `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'`, plus `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. No
  `unsafe-eval`; `unsafe-inline` is allowed for scripts and styles because Next.js
  inlines its bootstrap code.

### Untrusted documents

- **Upload size**: files over 5 MB are rejected before parsing.
- **Zip bombs**: a `.docx` is a zip. Its uncompressed size is checked from the zip
  directory **before** anything is inflated (limit 60 MB).
- **PDFs** are parsed with pdf.js (via `unpdf`). The bundled build has no eval-based
  font path, so the CVE-2024-4367 class of font-program code execution doesn't apply.
- **Client-supplied regular expressions**: the in-place `.docx` editor
  (`/api/tailor-docx`) receives find/replace patterns from the page. Patterns are
  length-limited and rejected if they contain nested quantifiers, quantified
  alternations or back-references (catastrophic-backtracking shapes).
- **No HTML injection**: React escapes all rendered text; the app uses no
  `dangerouslySetInnerHTML`, `eval` or `new Function`.

### AI mode (optional)

Resume and JD text are sent to Claude as tagged, untrusted data; model output is
schema-validated, and any claimed "semantic match" only earns credit if the quoted
phrase really appears in the resume. Suggested rewrites from Claude pass the same
safety checks as the built-in ones.

## Dependencies

`npm audit --omit=dev` (runtime dependencies) reports **no known vulnerabilities**.
CI runs it on every push, and Dependabot watches npm packages and GitHub Actions.

### Known advisories in build-time tooling

`npm audit` (including dev dependencies) still lists advisories in **Tailwind CSS v3's**
build toolchain: `braces` / `micromatch` / `fast-glob` / `chokidar` (stack-exhaustion
DoS on crafted glob patterns) and `postcss-selector-parser` (quadratic parsing). These
run **only at build time**, over this repository's own source files, never on user
input at runtime. `braces` has no patched release, and the only fix npm offers is a
breaking upgrade to Tailwind v4. A PR migrating to Tailwind v4 is welcome.

## Supported versions

Only the latest release receives fixes. Please upgrade before reporting.
