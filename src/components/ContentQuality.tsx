"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, MessageSquareWarning, Repeat, SpellCheck, Sparkles, Volume2, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult, WritingIssueKind } from "@/lib/types";
import { bandOf, cn } from "@/lib/utils";

const KINDS: { id: WritingIssueKind; label: string; icon: typeof SpellCheck; blurb: string }[] = [
  { id: "spelling", label: "Spelling", icon: SpellCheck, blurb: "Checked offline against an English dictionary plus a tech/skills vocabulary." },
  { id: "grammar", label: "Grammar & mechanics", icon: MessageSquareWarning, blurb: "Repeated words, a/an, tense in past roles, passive voice, capitalization, punctuation consistency." },
  { id: "tone", label: "Tone", icon: Volume2, blurb: "First-person pronouns and informal language." },
  { id: "buzzword", label: "Buzzwords & clichés", icon: Sparkles, blurb: "Claims recruiters skim past. Replace with evidence." },
  { id: "repetition", label: "Repetition", icon: Repeat, blurb: "Verbs, words and phrases you lean on too often." },
  { id: "filler", label: "Filler words", icon: Wind, blurb: "Words that add length without meaning." },
];

export function ContentQuality({ result }: { result: AnalysisResult }) {
  const w = result.writing;
  const [kind, setKind] = useState<WritingIssueKind | "all">("all");
  const issues = useMemo(() => w.issues.filter((i) => kind === "all" || i.kind === kind), [w, kind]);
  const color = bandOf(w.score).color;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Writing quality</CardTitle>
            <CardDescription>{result.mode === "general" ? "Counts for 20% of the general score." : "Advisory: not part of the match score."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums">{w.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
              <div className="h-full rounded-full" style={{ width: `${w.score}%`, background: color }} />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted p-2">
                <dt className="text-muted-foreground">Tone</dt>
                <dd className="font-semibold capitalize">{w.tone}</dd>
              </div>
              <div className="rounded-md bg-muted p-2">
                <dt className="text-muted-foreground">Word count</dt>
                <dd className="font-semibold tabular-nums">{w.wordCount}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-3">
            <Button size="sm" variant={kind === "all" ? "default" : "ghost"} className="w-full justify-between" onClick={() => setKind("all")}>
              All issues <span className="tabular-nums">{w.issues.length}</span>
            </Button>
            {KINDS.map((k) => {
              const n = w.issues.filter((i) => i.kind === k.id).length;
              const Icon = k.icon;
              return (
                <Button key={k.id} size="sm" variant={kind === k.id ? "default" : "ghost"} className="w-full justify-between" onClick={() => setKind(k.id)} aria-pressed={kind === k.id}>
                  <span className="flex items-center gap-2">
                    <Icon aria-hidden /> {k.label}
                  </span>
                  <span className="tabular-nums">{n}</span>
                </Button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{kind === "all" ? "All writing issues" : KINDS.find((k) => k.id === kind)!.label}</CardTitle>
          <CardDescription>{kind === "all" ? "Spelling and grammar first, then tone, buzzwords, repetition and filler." : KINDS.find((k) => k.id === kind)!.blurb}</CardDescription>
        </CardHeader>
        <CardContent>
          {issues.length ? (
            <ul className="space-y-2">
              {issues.map((i, idx) => (
                <li key={idx} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide", "bg-muted text-muted-foreground")}>{i.kind}</span>
                    <p className="text-sm font-medium">{i.message}</p>
                    {(i.count ?? 1) > 1 && i.kind !== "repetition" && <span className="text-xs text-muted-foreground">×{i.count}</span>}
                  </div>
                  {i.suggestions.length > 0 && <p className="mt-1 text-sm">Try: {i.suggestions.map((s) => `"${s}"`).join(", ")}</p>}
                  {i.context && <p className="mt-1 truncate text-xs text-muted-foreground">“{i.context}”</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-[hsl(var(--good))]" aria-hidden /> Nothing to fix here.
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Spelling uses an offline dictionary, so rare proper nouns or niche tools can show up as false positives; ignore those.</p>
        </CardContent>
      </Card>
    </div>
  );
}
