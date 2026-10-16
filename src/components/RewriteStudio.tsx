"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CheckCircle2, Copy, Loader2, MousePointerClick, Plus, Sparkles, Wand2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult, BulletAudit } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  result: AnalysisResult;
  workingText: string;
  onReplace: (original: string, replacement: string) => boolean;
  useLLM: boolean;
}

/** Render [placeholders] as highlighted chips so users notice what they must fill in. */
function WithPlaceholders({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[.+\]$/.test(p) ? (
          <mark key={i} className="rounded bg-[hsl(var(--warn)/0.25)] px-1 text-foreground" title="Fill in with your real number">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (t: string) => {
      try {
        await navigator.clipboard.writeText(t);
        setCopied(t);
        setTimeout(() => setCopied(null), 1500);
      } catch {
        /* clipboard blocked */
      }
    },
  };
}

function Indicator({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      {ok ? <CheckCircle2 className="size-3 text-[hsl(var(--good))]" aria-hidden /> : <XCircle className="size-3 text-[hsl(var(--bad))]" aria-hidden />}
      {label}
    </span>
  );
}

export function RewriteStudio({ result, workingText, onReplace, useLLM }: Props) {
  const { copied, copy } = useCopy();
  const [selected, setSelected] = useState<BulletAudit | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [source, setSource] = useState<"ai" | "heuristic" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const missing = useMemo(() => [...result.keywords.missingMustHave, ...result.keywords.missingNiceToHave], [result]);
  const bullets = useMemo(() => [...result.bulletAudit].sort((a, b) => a.score - b.score), [result]);
  const present = (t: string) => workingText.includes(t);

  const apply = (orig: string, next: string) => {
    const ok = onReplace(orig, next);
    setFlash(ok ? "Applied to your tailored resume (see Export tab)." : "That bullet was already changed. Edit it directly in the Export tab.");
    setTimeout(() => setFlash(null), 2500);
  };

  const generate = async (b: BulletAudit) => {
    setSelected(b);
    setOptions([]);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bullet: b.text,
          missingKeywords: missing.slice(0, 12),
          targetTitle: result.jd.targetTitle,
          responsibilities: result.jd.responsibilities.slice(0, 10),
          context: b.role,
          useLLM,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Rewrite failed");
      setOptions(data.options);
      setSource(data.source);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <AnimatePresence>
        {flash && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-md border bg-accent px-3 py-2 text-sm text-accent-foreground" role="status">
            {flash}
          </motion.div>
        )}
      </AnimatePresence>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4" aria-hidden /> Missing keyword inserter
          </CardTitle>
          <CardDescription>
            Where each missing keyword fits naturally, one keyword per bullet, no stuffing. Only add a keyword if you have really used it.{" "}
            <mark className="rounded bg-[hsl(var(--warn)/0.25)] px-1 text-foreground">[Brackets]</mark> mark numbers only you can fill in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.keywordPlacements.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {result.keywordPlacements.map((p) => (
                <li key={p.keyword} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={p.priority === "must" ? "bad" : "warn"}>{p.keyword}</Badge>
                    <span className="text-xs text-muted-foreground">{p.priority === "must" ? "must-have" : "nice-to-have"} → {p.section}</span>
                  </div>
                  {p.targetBullet && <p className="text-xs text-muted-foreground line-through decoration-muted-foreground/50">{p.targetBullet}</p>}
                  <p className="text-sm">
                    <WithPlaceholders text={p.suggestion} />
                  </p>
                  <div className="mt-auto flex gap-2">
                    {p.targetBullet && (
                      <Button size="sm" onClick={() => apply(p.targetBullet!, p.suggestion)} disabled={!present(p.targetBullet)}>
                        {present(p.targetBullet) ? <Check /> : <CheckCircle2 />} {present(p.targetBullet) ? "Apply" : "Applied"}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => copy(p.suggestion)}>
                      <Copy /> {copied === p.suggestion ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No missing hard-skill keywords. Nice.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MousePointerClick className="size-4" aria-hidden /> Your bullets, weakest first
            </CardTitle>
            <CardDescription>Select one to generate 3 ATS-optimized rewrites.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[560px] space-y-2 overflow-y-auto">
            {bullets.length ? (
              bullets.map((b, i) => (
                <button
                  key={i}
                  onClick={() => generate(b)}
                  className={cn(
                    "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/60",
                    selected?.text === b.text && "border-primary bg-accent",
                    !present(b.text) && "opacity-60",
                  )}
                >
                  <p className="text-sm">{b.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-3">
                    <Indicator ok={b.strongVerb} label={b.weakPhrase ? `weak opener "${b.weakPhrase}"` : "action verb"} />
                    <Indicator ok={b.hasMetric} label="metric" />
                    <span className="ml-auto text-[11px] text-muted-foreground">{b.role}</span>
                  </div>
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No bullet points were detected under your experience section.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="size-4" aria-hidden /> 1-click bullet rewriter
            </CardTitle>
            <CardDescription>
              {source === "ai" ? "Written by Claude." : source === "heuristic" ? "Built-in rewriter (enable Claude for richer rewrites)." : "Pick a bullet on the left."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Original</p>
                {selected.text}
              </div>
            )}
            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Generating options…
              </p>
            )}
            {error && <p className="text-sm text-[hsl(var(--bad))]">{error}</p>}
            {options.map((o, i) => (
              <motion.div key={o} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="rounded-md border p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">{["Impact-led", "Keyword-led", "Result-first"][i] ?? `Option ${i + 1}`}</p>
                <p className="text-sm">
                  <WithPlaceholders text={o} />
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => selected && apply(selected.text, o)} disabled={!selected || !present(selected.text)}>
                    <Check /> Use this
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copy(o)}>
                    <Copy /> {copied === o ? "Copied" : "Copy"}
                  </Button>
                </div>
              </motion.div>
            ))}
            {!selected && result.bulletPointImprovements.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="size-3.5" aria-hidden /> Suggested fixes from the analysis
                </p>
                {result.bulletPointImprovements.map((imp) => (
                  <div key={imp.original} className="rounded-md border p-3 text-sm">
                    <p className="text-xs text-muted-foreground line-through">{imp.original}</p>
                    <p className="mt-1">
                      <WithPlaceholders text={imp.suggested} />
                    </p>
                    {imp.swaps && imp.swaps.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs">
                        {imp.swaps.map((s, i) => (
                          <li key={i}>
                            <span className="text-muted-foreground line-through">{s.from || "(insert)"}</span> → <span className="font-medium">{s.to || "(remove)"}</span>
                          </li>
                        ))}
                        <li className="text-muted-foreground">
                          Word count {imp.wordDelta && imp.wordDelta > 0 ? `+${imp.wordDelta}` : (imp.wordDelta ?? 0)}
                        </li>
                      </ul>
                    )}
                    {imp.reason && <p className="mt-1 text-xs text-muted-foreground">Why: {imp.reason}</p>}
                    <Button size="sm" className="mt-2" onClick={() => apply(imp.original, imp.suggested)} disabled={!present(imp.original)}>
                      <Check /> {present(imp.original) ? "Apply" : "Applied"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
