/**
 * Calibration: compare our scores with ground truth and suggest category weights.
 *
 *   npm run calibrate                       # reads calibration/pairs.csv, built-in engine
 *   npm run calibrate -- --ai               # use Claude too (costs API credits)
 *   npm run calibrate -- --file other.csv
 *
 * pairs.csv columns (header row required):
 *   id, resume, jd, external_score, outcome, source
 *   - resume / jd: paths relative to calibration/ (PDF, DOCX or TXT; a JD may be .txt)
 *   - external_score: optional 0-100 score from another tool you ran yourself (e.g. Jobscan)
 *   - outcome: optional real result: 1 = got an interview / passed screen, 0 = rejected / no reply
 *   - source: free text, e.g. "Jobscan 2026-10" or "Workday application"
 *
 * Writes calibration/report.md and calibration/report.csv. It never changes the app's weights;
 * it prints suggested weights for you to review.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { analyze } from "../src/lib/analyze";
import { parseResumeFile } from "../src/lib/parsers";
import { WEIGHTS } from "../src/lib/scoring/engine";
import type { CategoryScores } from "../src/lib/types";

const DIR = "calibration";
const args = process.argv.slice(2);
const useLLM = args.includes("--ai");
const file = args.includes("--file") ? args[args.indexOf("--file") + 1] : path.join(DIR, "pairs.csv");

type Row = { id: string; resume: string; jd: string; external: number | null; outcome: number | null; source: string };
type Result = Row & { ours: number; cats: CategoryScores; knockout: string; parseRate: number };
const KEYS = Object.keys(WEIGHTS) as (keyof CategoryScores)[];

// ---------- CSV ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

function loadRows(): Row[] {
  if (!existsSync(file)) {
    console.error(`No ${file}. Copy calibration/pairs.example.csv to calibration/pairs.csv and fill it in (see calibration/README.md).`);
    process.exit(1);
  }
  const [header, ...body] = parseCsv(readFileSync(file, "utf8"));
  const h = header.map((x) => x.trim().toLowerCase());
  const col = (r: string[], name: string) => r[h.indexOf(name)]?.trim() ?? "";
  return body.map((r, i) => ({
    id: col(r, "id") || String(i + 1),
    resume: col(r, "resume"),
    jd: col(r, "jd"),
    external: col(r, "external_score") === "" ? null : Number(col(r, "external_score")),
    outcome: col(r, "outcome") === "" ? null : Number(col(r, "outcome")),
    source: col(r, "source"),
  }));
}

// ---------- Stats ----------
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
function pearson(x: number[], y: number[]) {
  const mx = mean(x);
  const my = mean(y);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) {
    n += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? n / Math.sqrt(dx * dy) : NaN;
}
function ranks(a: number[]) {
  const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(a.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));
const mae = (x: number[], y: number[]) => mean(x.map((v, i) => Math.abs(v - y[i])));
/** Probability a random positive outranks a random negative (Mann-Whitney AUC). */
function auc(scores: number[], labels: number[]) {
  const pos = scores.filter((_, i) => labels[i] === 1);
  const neg = scores.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return NaN;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/** Non-negative weights summing to 100 that best predict `target` from category scores (projected gradient). */
function fitWeights(cats: number[][], target: number[]): number[] {
  let w = KEYS.map((k) => WEIGHTS[k] / 100);
  const lr = 1e-6;
  for (let it = 0; it < 20000; it++) {
    const grad = w.map(() => 0);
    cats.forEach((c, i) => {
      const err = c.reduce((a, v, j) => a + v * w[j], 0) - target[i];
      c.forEach((v, j) => (grad[j] += 2 * err * v));
    });
    w = projectSimplex(w.map((x, j) => x - lr * grad[j]));
  }
  return w.map((x) => Math.round(x * 1000) / 10);
}
function projectSimplex(v: number[]): number[] {
  const u = [...v].sort((a, b) => b - a);
  let css = 0, rho = 0, theta = 0;
  for (let i = 0; i < u.length; i++) {
    css += u[i];
    const t = (css - 1) / (i + 1);
    if (u[i] - t > 0) (rho = i), (theta = t);
  }
  return v.map((x) => Math.max(0, x - theta));
}
const predict = (c: number[], w: number[]) => c.reduce((a, v, j) => a + (v * w[j]) / 100, 0);

// ---------- Run ----------
async function main() {
  const rows = loadRows();
  console.log(`Scoring ${rows.length} pair(s) with the ${useLLM ? "Claude-assisted" : "built-in"} engine...`);
  const results: Result[] = [];
  for (const r of rows) {
    try {
      const doc = await parseResumeFile(readFileSync(path.join(DIR, r.resume)), path.basename(r.resume));
      const jdPath = path.join(DIR, r.jd);
      const jd = /\.(pdf|docx)$/i.test(jdPath) ? (await parseResumeFile(readFileSync(jdPath), path.basename(jdPath))).text : readFileSync(jdPath, "utf8");
      const a = await analyze(doc, jd, { useLLM });
      results.push({ ...r, ours: a.overallScore, cats: a.categoryScores, knockout: a.knockouts?.status ?? "n/a", parseRate: a.atsView.parseRate });
      console.log(`  ${r.id}: ours ${a.overallScore}${r.external !== null ? ` vs external ${r.external}` : ""}${r.outcome !== null ? ` (outcome ${r.outcome})` : ""}`);
    } catch (e) {
      console.warn(`  ${r.id}: skipped (${(e as Error).message})`);
    }
  }

  const md: string[] = [`# Calibration report`, ``, `${results.length} pair(s), ${useLLM ? "Claude-assisted" : "built-in"} engine, ${new Date().toISOString().slice(0, 10)}.`, ``];
  const withExt = results.filter((r) => r.external !== null && !Number.isNaN(r.external));
  if (withExt.length >= 3) {
    const ours = withExt.map((r) => r.ours);
    const ext = withExt.map((r) => r.external!);
    md.push(`## Agreement with external scores (${withExt.length} pairs)`, ``);
    md.push(`| Metric | Value | Reading |`, `|---|---|---|`);
    md.push(`| Pearson r | ${pearson(ours, ext).toFixed(2)} | linear agreement; above 0.7 is strong |`);
    md.push(`| Spearman ρ | ${spearman(ours, ext).toFixed(2)} | do we *rank* resumes the same way? |`);
    md.push(`| Mean absolute difference | ${mae(ours, ext).toFixed(1)} pts | typical gap between the two numbers |`);
    md.push(`| Mean bias | ${(mean(ours) - mean(ext)).toFixed(1)} pts | positive = we score higher |`, ``);

    if (withExt.length >= 8 && withExt.every((r) => r.cats.hardSkills !== null)) {
      const cats = withExt.map((r) => KEYS.map((k) => r.cats[k] as number));
      const fitted = fitWeights(cats, ext);
      // Leave-one-out: honest estimate of how fitted weights would do on a new pair.
      const looErr = cats.map((_, i) => {
        const w = fitWeights(cats.filter((_, j) => j !== i), ext.filter((_, j) => j !== i));
        return Math.abs(predict(cats[i], w) - ext[i]);
      });
      const current = KEYS.map((k) => WEIGHTS[k]);
      md.push(`## Suggested weights (fit to external scores)`, ``, `| Category | Current | Fitted |`, `|---|---|---|`);
      KEYS.forEach((k, j) => md.push(`| ${k} | ${current[j]} | ${fitted[j]} |`));
      md.push(``, `Mean absolute difference: current weights ${mae(cats.map((c) => predict(c, current)), ext).toFixed(1)} pts → fitted ${mae(cats.map((c) => predict(c, fitted)), ext).toFixed(1)} pts in-sample, **${mean(looErr).toFixed(1)} pts leave-one-out** (the number to trust).`);
      md.push(withExt.length < 25 ? `\n> Fewer than 25 pairs: treat fitted weights as directional, not final.` : "", ``);
    } else md.push(`_Add at least 8 match-mode pairs with external scores to fit weights._`, ``);
  } else md.push(`_No external scores yet (need 3+). Fill the external_score column to compare with another tool._`, ``);

  const withOut = results.filter((r) => r.outcome === 0 || r.outcome === 1);
  if (withOut.length >= 4) {
    const s = withOut.map((r) => r.ours);
    const y = withOut.map((r) => r.outcome!);
    const a = auc(s, y);
    const pos = withOut.filter((r) => r.outcome === 1).map((r) => r.ours);
    const neg = withOut.filter((r) => r.outcome === 0).map((r) => r.ours);
    let best = { t: 0, j: -1 };
    for (let t = 30; t <= 95; t++) {
      const tpr = pos.filter((v) => v >= t).length / Math.max(1, pos.length);
      const fpr = neg.filter((v) => v >= t).length / Math.max(1, neg.length);
      if (tpr - fpr > best.j) best = { t, j: tpr - fpr };
    }
    const koRejected = withOut.filter((r) => r.knockout === "likely-reject");
    md.push(`## Prediction of real outcomes (${withOut.length} applications)`, ``, `| Metric | Value |`, `|---|---|`);
    md.push(`| AUC | ${Number.isNaN(a) ? "n/a (need both outcomes)" : a.toFixed(2)} (0.5 = coin flip, 0.7+ useful, 0.8+ strong) |`);
    md.push(`| Mean score, got interview | ${pos.length ? mean(pos).toFixed(1) : "—"} |`);
    md.push(`| Mean score, rejected | ${neg.length ? mean(neg).toFixed(1) : "—"} |`);
    md.push(`| Best cut-off | ${best.j >= 0 ? best.t : "—"} (maximises hit rate minus false-alarm rate) |`);
    md.push(`| Flagged "likely auto-reject" that were rejected | ${koRejected.filter((r) => r.outcome === 0).length} / ${koRejected.length} |`, ``);
  } else md.push(`_Add 4+ rows with outcome (1/0) to measure how well the score predicts interviews._`, ``);

  md.push(`## Per pair`, ``, `| id | ours | external | outcome | knockout | parse rate | source |`, `|---|---|---|---|---|---|---|`);
  for (const r of results) md.push(`| ${r.id} | ${r.ours} | ${r.external ?? ""} | ${r.outcome ?? ""} | ${r.knockout} | ${r.parseRate} | ${r.source} |`);
  writeFileSync(path.join(DIR, "report.md"), md.join("\n") + "\n");
  writeFileSync(
    path.join(DIR, "report.csv"),
    ["id,ours,external,outcome,knockout,parse_rate," + KEYS.join(","), ...results.map((r) => [r.id, r.ours, r.external ?? "", r.outcome ?? "", r.knockout, r.parseRate, ...KEYS.map((k) => r.cats[k] ?? "")].join(","))].join("\n") + "\n",
  );
  console.log(`\nWrote ${DIR}/report.md and ${DIR}/report.csv`);
}

main();
