"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Ban, Check, ClipboardList, FileDown, Loader2, RotateCcw, Sparkles, Target, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult } from "@/lib/types";
import { DEFAULT_OPTIONS, applyChanges, manualTodos, placeholders, planTailoring, selectionPlan, type ChangeKind, type TailorChange, type TailorOptions } from "@/lib/tailor";
import type { Ladder, LadderStep } from "@/lib/target";
import { bandOf, cn } from "@/lib/utils";

interface Props {
  /** Analysis of the resume as uploaded: tailoring always starts from this. */
  baseResult: AnalysisResult;
  /** Latest analysis (of the tailored text once applied). */
  result: AnalysisResult;
  original: string;
  workingText: string;
  rescoring: boolean;
  onApply: (text: string) => Promise<void>;
  onOpenExport: () => void;
  /** The uploaded file (null for pasted text or samples). A .docx can be returned in its own formatting. */
  sourceFile: File | null;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download matching the upload: the edited original .docx, plain text, or (for PDFs) a change list. */
function FormatDownload({ sourceFile, fileType, changes, workingText }: { sourceFile: File | null; fileType: string; changes: TailorChange[]; workingText: string }) {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; err: boolean }>({ busy: false, msg: null, err: false });
  const live = changes.filter((c) => c.enabled && !c.blocked);
  const base = (sourceFile?.name ?? "resume").replace(/\.\w+$/, "").replace(/[^\w.-]+/g, "-");

  const docx = async () => {
    if (!sourceFile) return;
    setState({ busy: true, msg: null, err: false });
    try {
      const form = new FormData();
      form.append("resume", sourceFile);
      form.append("changes", JSON.stringify(live));
      const res = await fetch("/api/tailor-docx", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Couldn't build the .docx");
      const missing = (res.headers.get("X-Not-Found") ?? "").split(",").filter(Boolean).length;
      saveBlob(await res.blob(), `${base}-tailored.docx`);
      setState({
        busy: false,
        err: false,
        msg: missing ? `Downloaded. ${missing} change(s) couldn't be matched in the Word file; apply those by hand.` : "Downloaded: same fonts, layout and line count as your original.",
      });
    } catch (e) {
      setState({ busy: false, err: true, msg: (e as Error).message });
    }
  };

  const changeList = () =>
    live
      .filter((c) => c.before !== c.after)
      .map((c, i) => `${i + 1}. ${c.label}\n   Before: ${c.before}\n   After:  ${c.after}${c.note ? `\n   Note:   ${c.note}` : ""}`)
      .join("\n\n");

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <FileDown className="size-4" aria-hidden /> Get it in your original format
      </p>
      {fileType === "docx" && sourceFile ? (
        <>
          <p className="text-xs text-muted-foreground">Edits your own Word file in place: every font, bullet, table and margin stays the same, and no lines are added.</p>
          <Button size="sm" onClick={docx} disabled={state.busy || !live.length}>
            {state.busy ? <Loader2 className="animate-spin" /> : <FileDown />} Download tailored .docx
          </Button>
        </>
      ) : fileType === "pdf" ? (
        <>
          <p className="text-xs text-muted-foreground">
            A PDF can&apos;t be safely rewritten in place: its embedded fonts usually only contain the letters already used. For a tailored copy in your exact layout, upload the
            .docx you made the PDF from. Or apply the changes below in your source file: each one keeps the same number of lines.
          </p>
          <Button size="sm" variant="outline" onClick={() => saveBlob(new Blob([changeList()], { type: "text/plain;charset=utf-8" }), `${base}-changes.txt`)} disabled={!live.length}>
            <FileDown /> Download change list (.txt)
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Same plain-text layout as your input, line for line.</p>
          <Button size="sm" variant="outline" onClick={() => saveBlob(new Blob([workingText], { type: "text/plain;charset=utf-8" }), `${base}-tailored.txt`)}>
            <FileDown /> Download tailored .txt
          </Button>
        </>
      )}
      {state.msg && <p className={cn("text-xs", state.err ? "text-[hsl(var(--bad))]" : "text-muted-foreground")}>{state.msg}</p>}
    </div>
  );
}

const OPTION_LABELS: { key: keyof TailorOptions; label: string; hint: string }[] = [
  { key: "headings", label: "Standard section headings", hint: '"Where I\'ve Been" → "Work Experience"' },
  { key: "dates", label: "One consistent date format", hint: "01/2021 → Jan 2021" },
  { key: "bullets", label: "Stronger bullet openers", hint: '"Responsible for X" → "Managed X" (never inflates your role)' },
  { key: "spelling", label: "Fix spelling", hint: "only confident one-word fixes" },
  { key: "grammar", label: "Fix grammar slips", hint: "repeated words, a/an, double spaces" },
  { key: "filler", label: "Cut filler words", hint: '"in order to" → "to"' },
  { key: "acronyms", label: "Acronym + full term", hint: '"AWS" → "Amazon Web Services (AWS)" once' },
  { key: "metricPlaceholders", label: "Add result placeholders", hint: "swaps vague words like \"several\" for [N]; you fill in the real number" },
];

const KIND_LABEL: Record<ChangeKind, string> = {
  heading: "Headings",
  date: "Dates",
  bullet: "Bullet openers",
  metric: "Result placeholders",
  keyword: "Keywords you confirmed",
  acronym: "Acronyms",
  filler: "Filler",
  spelling: "Spelling",
  grammar: "Grammar",
};

/** Shortest run of ladder steps that reaches the target, skipping keywords the user hasn't confirmed. */
function pickSteps(ladder: Ladder, target: number, confirmed: Set<string>) {
  let projected = ladder.baseScore;
  const chosen: LadderStep[] = [];
  for (const s of ladder.steps) {
    if (projected >= target) break;
    if (s.keyword && !confirmed.has(s.keyword)) continue;
    chosen.push(s);
    projected = Math.min(100, projected + s.gain);
  }
  // Highest score reachable with everything confirmed so far.
  const reachable = Math.min(100, ladder.baseScore + ladder.steps.filter((s) => !s.keyword || confirmed.has(s.keyword)).reduce((a, s) => a + s.gain, 0));
  return { chosen, projected, reachable };
}

/** Slider: pick a target ATS score and see the fewest honest changes that get there. */
function TargetScore({ ladder, onApply, working }: { ladder: Ladder; onApply: (steps: LadderStep[]) => void; working: boolean }) {
  const base = ladder.baseScore;
  const [target, setTarget] = useState(() => Math.min(Math.max(base + 1, 75), Math.max(base + 1, ladder.maxProjected)));
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const { chosen, projected, reachable } = useMemo(() => pickSteps(ladder, target, confirmed), [ladder, target, confirmed]);
  const reached = projected >= target;
  const autoCount = chosen.filter((s) => !s.keyword).length;
  const kwSteps = ladder.steps.filter((s) => s.keyword);
  // Keywords that would help reach this target but aren't confirmed yet.
  const unlock = !reached ? kwSteps.filter((s) => !confirmed.has(s.keyword!)) : [];
  const toggle = (k: string) => setConfirmed((c) => (c.has(k) ? new Set([...c].filter((x) => x !== k)) : new Set([...c, k])));

  return (
    <div className="space-y-4 rounded-md border border-primary/40 bg-accent/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Target className="size-4 text-primary" aria-hidden /> Target ATS score
        </p>
        <p className="text-xs text-muted-foreground">
          Now <span className="font-semibold tabular-nums">{base}</span> · best possible with honest changes{" "}
          <span className="font-semibold tabular-nums">{ladder.maxProjected}</span>
        </p>
      </div>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={base}
          max={100}
          step={1}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))]"
          aria-label="Target ATS score"
        />
        <span className="w-14 text-right text-2xl font-bold tabular-nums" style={{ color: bandOf(target).color }}>
          {target}
        </span>
      </div>

      <p className={cn("flex items-start gap-2 text-sm", reached ? "" : "text-[hsl(var(--bad))]")}>
        {reached ? <Check className="mt-0.5 size-4 shrink-0 text-[hsl(var(--good))]" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
        {target <= base
          ? "You're already at this score."
          : reached
            ? `Reachable: ${chosen.length} change${chosen.length === 1 ? "" : "s"} (${autoCount} automatic${chosen.length - autoCount ? `, ${chosen.length - autoCount} keyword${chosen.length - autoCount > 1 ? "s" : ""} you confirmed` : ""}) → projected ${projected}.`
            : target > ladder.maxProjected || (reachable < target && unlock.length === 0)
              ? `Not reachable honestly: the most these changes can do is ${ladder.maxProjected}${ladder.maxProjected > projected ? " (with every listed skill confirmed)" : ""}. Going higher needs real new content: see "Still for you to do" after applying.`
              : `Automatic fixes get you to ${projected}. To reach ${target}, confirm skills below that you've genuinely used, or pick a lower target.`}
      </p>

      {chosen.length > 0 && (
        <ol className="space-y-1 text-sm">
          {chosen.map((s, i) => (
            <li key={s.key} className="flex items-baseline gap-2">
              <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <span className="flex-1">{s.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {s.gain > 0 ? `+${s.gain}` : s.gain === 0 ? "±0" : s.gain}
              </span>
            </li>
          ))}
        </ol>
      )}

      {kwSteps.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Skills you can vouch for (each adds points only if you tick it):</p>
          <div className="flex flex-wrap gap-2">
            {kwSteps.map((s) => {
              const on = confirmed.has(s.keyword!);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggle(s.keyword!)}
                  aria-pressed={on}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted", unlock.includes(s) && !on && "border-primary/60")}
                >
                  {on && <Check className="size-3" aria-hidden />}
                  {s.keyword} <span className="opacity-75 tabular-nums">+{s.gain}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {ladder.noRoom.length > 0 && <p className="text-xs text-muted-foreground">No room to add without extra lines: {ladder.noRoom.join(", ")}.</p>}

      <Button onClick={() => onApply(chosen)} disabled={working || !chosen.length}>
        {working ? <Loader2 className="animate-spin" /> : <Target />} Apply {chosen.length} change{chosen.length === 1 ? "" : "s"} for {reached ? target : projected}
      </Button>
      <p className="text-xs text-muted-foreground">
        Projections are measured by re-scoring each step. Knockout issues (location, visa, clearance) aren&apos;t part of the score, so check them separately.
      </p>
    </div>
  );
}

export function AutoTailor({ baseResult, result, original, workingText, rescoring, onApply, onOpenExport, sourceFile }: Props) {
  const [opts, setOpts] = useState<TailorOptions>(DEFAULT_OPTIONS);
  const [changes, setChanges] = useState<TailorChange[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [ladderErr, setLadderErr] = useState<string | null>(null);

  // Measure the target-score ladder once per uploaded analysis.
  useEffect(() => {
    let alive = true;
    setLadder(null);
    setLadderErr(null);
    fetch("/api/target-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base: baseResult }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error?.message ?? "Couldn't plan target scores");
        if (alive) setLadder(d as Ladder);
      })
      .catch((e) => alive && setLadderErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [baseResult]);

  // Score of the tailored resume *in the uploaded file*: the file's score plus the measured gain,
  // so layout penalties that the in-place edit keeps aren't silently dropped.
  const projectedScore = ladder ? Math.max(0, Math.min(100, baseResult.overallScore + (result.overallScore - ladder.textBaseline))) : result.overallScore;

  // Missing hard skills / tools / certifications the user can vouch for.
  const candidates = useMemo(
    () =>
      baseResult.keywords.details
        .filter((m) => m.credit < 0.8 && m.category !== "soft_skill")
        .sort((a, b) => (a.priority === b.priority ? b.jdCount - a.jdCount : a.priority === "must" ? -1 : 1)),
    [baseResult],
  );
  const manualEdits = workingText !== original && !changes;
  const toggle = (key: keyof TailorOptions) => setOpts((o) => ({ ...o, [key]: !o[key] }));
  const toggleKeyword = (k: string) => setOpts((o) => ({ ...o, addKeywords: o.addKeywords.includes(k) ? o.addKeywords.filter((x) => x !== k) : [...o.addKeywords, k] }));

  const run = async (planned: TailorChange[]) => {
    setBusy(true);
    const { text, skipped: sk } = applyChanges(original, planned);
    setChanges(planned);
    setSkipped(sk);
    await onApply(text);
    setBusy(false);
  };

  const create = () => run(planTailoring(baseResult, opts));
  const toggleChange = (id: string) => setChanges((cs) => cs && cs.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
  const undo = async () => {
    setBusy(true);
    setChanges(null);
    await onApply(original);
    setBusy(false);
  };

  const grouped = useMemo(() => {
    const g = new Map<ChangeKind, TailorChange[]>();
    for (const c of changes ?? []) g.set(c.kind, [...(g.get(c.kind) ?? []), c]);
    return [...g.entries()];
  }, [changes]);
  const pending = changes && applyChanges(original, changes).text !== workingText;
  const holes = placeholders(workingText);
  const todos = manualTodos(baseResult, opts);
  const working = busy || rescoring;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="size-4 text-primary" aria-hidden /> Auto-tailor my resume
        </CardTitle>
        <CardDescription>
          Applies the best safe fixes in one click, re-scores the result, and lists every change so you can switch any of them off. Edits are sized to fit
          your existing lines, so nothing adds a line or changes your layout. It never adds a skill you haven&apos;t confirmed or invents a number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!changes ? (
          <>
            {ladder ? (
              <TargetScore
                ladder={ladder}
                working={working}
                onApply={(steps) => {
                  const keys = new Set(steps.filter((s) => !s.keyword).map((s) => s.key));
                  const kws = steps.filter((s) => s.keyword).map((s) => s.keyword!);
                  setOpts((o) => ({ ...o, addKeywords: kws }));
                  void run(selectionPlan(baseResult, keys, kws));
                }}
              />
            ) : ladderErr ? (
              <p className="text-xs text-[hsl(var(--bad))]">Target-score planner unavailable: {ladderErr}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Measuring how much each change is worth…
              </p>
            )}
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Or choose the fixes yourself</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {OPTION_LABELS.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm hover:bg-muted/50">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={!!opts[o.key]} onChange={() => toggle(o.key)} />
                  <span>
                    <span className="font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {baseResult.mode === "match" && candidates.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Missing keywords: tick only the ones you have real experience with</p>
                <div className="flex flex-wrap gap-2">
                  {candidates.map((m) => {
                    const on = opts.addKeywords.includes(m.term);
                    return (
                      <button
                        key={m.term}
                        type="button"
                        onClick={() => toggleKeyword(m.term)}
                        aria-pressed={on}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                          on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                        )}
                      >
                        {on && <Check className="size-3" aria-hidden />}
                        {m.term}
                        <span className={cn("opacity-70", on && "opacity-90")}>{m.priority === "must" ? "· must" : "· nice"}</span>
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="size-3.5 accent-[hsl(var(--primary))]" checked={opts.weaveKeywords} onChange={() => toggle("weaveKeywords")} disabled={!opts.addKeywords.length} />
                  Also mention them in the best-matching bullet (otherwise they&apos;re added to Skills only)
                </label>
              </div>
            )}

            {manualEdits && (
              <p className="flex items-start gap-2 rounded-md border border-[hsl(var(--warn)/0.7)] bg-[hsl(var(--warn)/0.1)] p-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Auto-tailor starts from your uploaded resume and replaces the manual edits you made in the Export tab.
              </p>
            )}
            <Button onClick={create} disabled={working} size="lg">
              {working ? <Loader2 className="animate-spin" /> : <Sparkles />} {working ? "Tailoring…" : "Create tailored resume"}
            </Button>
          </>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
            <div className="flex flex-wrap items-center gap-4 rounded-md bg-muted p-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Score </span>
                <span className="font-semibold tabular-nums">{baseResult.overallScore}</span>
                <ArrowRight className="mx-1 inline size-4 text-muted-foreground" aria-hidden />
                {working ? (
                  <Loader2 className="inline size-4 animate-spin" aria-label="Re-scoring" />
                ) : (
                  <span className="text-lg font-bold tabular-nums" style={{ color: bandOf(projectedScore).color }}>
                    {projectedScore}
                  </span>
                )}
                {!working && <span className="ml-1 text-xs text-muted-foreground">({projectedScore - baseResult.overallScore >= 0 ? "+" : ""}{projectedScore - baseResult.overallScore}){ladder && baseResult.resume.fileType !== "txt" ? " in your file" : ""}</span>}
              </div>
              <div className="text-sm text-muted-foreground">
                {changes.filter((c) => c.enabled && !c.blocked && !skipped.includes(c.id)).length} of {changes.length} changes applied
                {changes.some((c) => c.blocked) && ` · ${changes.filter((c) => c.blocked).length} held back to keep your line count`}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={onOpenExport} disabled={working}>
                  Review &amp; download <ArrowRight />
                </Button>
                <Button size="sm" variant="ghost" onClick={undo} disabled={working}>
                  <RotateCcw /> Undo all
                </Button>
              </div>
            </div>

            {holes.length > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-[hsl(var(--warn)/0.7)] bg-[hsl(var(--warn)/0.1)] p-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Fill in {holes.length} placeholder{holes.length > 1 ? "s" : ""} before sending: {holes.slice(0, 4).join(", ")}. Edit them in the Export tab.
              </p>
            )}

            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to change automatically. Check the manual to-dos below.</p>
            ) : (
              <div className="space-y-4">
                {grouped.map(([kind, list]) => (
                  <div key={kind}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {KIND_LABEL[kind]} <span className="tabular-nums">({list.length})</span>
                    </p>
                    <ul className="space-y-1.5">
                      {list.map((c) => (
                        <li key={c.id} className={cn("rounded-md border p-2.5 text-sm", (!c.enabled || c.blocked) && "opacity-60")}>
                          <label className="flex cursor-pointer items-start gap-2">
                            {c.blocked ? (
                              <Ban className="mt-1 size-4 shrink-0 text-muted-foreground" aria-label="Not applied" />
                            ) : (
                              <input type="checkbox" className="mt-1 size-4 accent-[hsl(var(--primary))]" checked={c.enabled} onChange={() => toggleChange(c.id)} />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{c.label}</span>
                              {skipped.includes(c.id) && <Badge variant="warn" className="ml-2">skipped: text already changed</Badge>}
                              {c.before !== c.after && c.before.length < 400 && (
                                <span className="mt-1 block text-xs">
                                  <del className="text-muted-foreground">{c.before}</del>
                                  <br />
                                  <ins className="no-underline">{c.after}</ins>
                                </span>
                              )}
                              {c.blocked && <span className="mt-1 block text-xs text-muted-foreground">{c.blocked}</span>}
                              {c.note && !c.blocked && <span className="mt-1 block text-xs text-[hsl(var(--bad))]">{c.note}</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {pending && (
                  <Button onClick={() => run(changes)} disabled={working}>
                    {working ? <Loader2 className="animate-spin" /> : <Check />} Update tailored resume
                  </Button>
                )}
              </div>
            )}

            <FormatDownload sourceFile={sourceFile} fileType={baseResult.resume.fileType} changes={changes} workingText={workingText} />

            {todos.length > 0 && (
              <div className="rounded-md border p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <ClipboardList className="size-4" aria-hidden /> Still for you to do (not automated on purpose)
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {todos.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
