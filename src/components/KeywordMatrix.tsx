"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ALargeSmall, AlertTriangle, Check, Info, Repeat, Table2, Tags, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult, KeywordCategory, KeywordMatch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CREDIT } from "@/lib/nlp/matcher";

const FILTERS: { id: "all" | KeywordCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hard_skill", label: "Hard Skills" },
  { id: "tool", label: "Tools / Technologies" },
  { id: "certification", label: "Certifications" },
  { id: "soft_skill", label: "Soft Skills" },
];

const MATCH_LABEL: Record<KeywordMatch["matchType"], string> = {
  exact: "Exact match",
  alias: "Matched via acronym/alias",
  "word-form": "Word-form match (e.g. managed vs manage)",
  semantic: "Semantic match (reworded / near-spelling)",
  related: "Partial: a sibling tool listed in the alias file",
  none: "Not found",
};

function tip(m: KeywordMatch) {
  const parts = [MATCH_LABEL[m.matchType]];
  if (m.matchedAs && m.matchType !== "exact") parts.push(`found as "${m.matchedAs}"`);
  if (m.locations.length) parts.push(`in: ${m.locations.join(", ")}`);
  if (m.evidence) parts.push(`evidence: "${m.evidence}"`);
  if (m.recencyBoosted) parts.push("1.5x recency boost");
  parts.push(`JD mentions it ${m.jdCount}x, your resume ${m.resumeCount}x`);
  return parts.join(" · ");
}

/** Evidence line with the matched words (marked [like this] by the matcher) in bold. */
function Evidence({ text }: { text: string }) {
  const m = text.match(/^(.*?)\[([^\]]+)\](.*)$/);
  if (!m) return <>“{text}”</>;
  return (
    <>
      “{m[1]}
      <strong className="font-semibold text-foreground">{m[2]}</strong>
      {m[3]}”
    </>
  );
}

function Pill({ m }: { m: KeywordMatch }) {
  const matched = m.credit >= 0.8;
  const variant = matched ? "good" : m.priority === "must" ? "bad" : "warn";
  const Icon = matched ? Check : m.priority === "must" ? X : AlertTriangle;
  return (
    <Badge variant={variant} title={tip(m)} className="cursor-help py-1 text-[13px]">
      <Icon aria-hidden />
      {m.term}
      {m.jdCount > 1 && <span className="text-muted-foreground tabular-nums">×{m.jdCount}</span>}
      {m.matchType === "alias" || m.matchType === "word-form" || m.matchType === "semantic" ? <span className="text-muted-foreground">≈</span> : null}
      {m.matchType === "related" && <span className="text-muted-foreground">(partial)</span>}
    </Badge>
  );
}

function Bucket({ title, desc, items, icon }: { title: string; desc: string; items: KeywordMatch[]; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon} {title} <span className="ml-auto font-normal text-muted-foreground tabular-nums">{items.length}</span>
        </CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <motion.div layout className="flex flex-wrap gap-2">
            {items.map((m) => (
              <Pill key={m.term} m={m} />
            ))}
          </motion.div>
        ) : (
          <p className="text-sm text-muted-foreground">None in this filter.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function KeywordMatrix({ result }: { result: AnalysisResult }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [table, setTable] = useState(false);
  const details = useMemo(() => result.keywords.details.filter((m) => filter === "all" || m.category === filter), [filter, result]);
  const matched = details.filter((m) => m.credit >= 0.8);
  const missMust = details.filter((m) => m.credit < 0.8 && m.priority === "must");
  const missNice = details.filter((m) => m.credit < 0.8 && m.priority === "nice");
  const tips = details.filter((m) => m.acronymTip);
  // Same rule and same count as the report: matched keywords whose resume mentions (every
  // credited occurrence) fall short of the JD's.
  const underused = details.filter((m) => m.credit >= 0.8 && m.jdCount >= 2 && m.resumeCount < m.jdCount).sort((a, b) => b.jdCount - a.jdCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const n = f.id === "all" ? result.keywords.details.length : result.keywords.details.filter((m) => m.category === f.id).length;
          return (
            <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
              {f.label} <span className="tabular-nums opacity-70">{n}</span>
            </Button>
          );
        })}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? <Tags /> : <Table2 />} {table ? "Pill view" : "Table view"}
        </Button>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Hover a keyword for how it matched and the resume line that proves it, with the matched words in bold (Table view lists them all). ≈ means matched through an
        acronym, alias or another word form (full credit) or a reworded phrase (80%); a match always needs the keyword&apos;s own head word in that line unless the
        alias file lists the phrase. &quot;Partial&quot; means you show a sibling tool listed in the alias file (e.g. MySQL for PostgreSQL), which earns {Math.round(CREDIT.related * 100)}% credit but
        should still be named explicitly. JD parsed by {result.jd.source === "ai" ? "Claude" : "the built-in parser"}.
      </p>

      {table ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Keyword</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Match tier</th>
                  <th className="px-4 py-2 font-medium">JD / You</th>
                  <th className="px-4 py-2 font-medium">Credit</th>
                  <th className="px-4 py-2 font-medium">Found in</th>
                  <th className="px-4 py-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {details.map((m) => (
                  <tr key={m.term} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{m.term}</td>
                    <td className="px-4 py-2 text-muted-foreground">{FILTERS.find((f) => f.id === m.category)?.label}</td>
                    <td className="px-4 py-2">{m.priority === "must" ? "Must-have (2x)" : "Nice-to-have (1x)"}</td>
                    <td className={cn("px-4 py-2")}>
                      {MATCH_LABEL[m.matchType]}
                      {m.matchedAs && m.matchType !== "exact" ? <span className="text-muted-foreground"> · “{m.matchedAs}”</span> : null}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {m.jdCount}× / {m.resumeCount}×{m.frequencyWeight > 1 ? <span className="text-muted-foreground"> ({m.frequencyWeight}x wt)</span> : null}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{Math.round(m.credit * 100)}%</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {m.locations.join(", ") || "—"}
                      {m.recencyBoosted ? " (1.5x)" : ""}
                    </td>
                    <td className="max-w-[28rem] px-4 py-2 text-xs text-muted-foreground">{m.evidence ? <Evidence text={m.evidence} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Bucket title="Matched" desc="Found in your resume." items={matched} icon={<Check className="size-4 text-[hsl(var(--good))]" aria-hidden />} />
          <Bucket title="Missing critical (must-have)" desc="Required by the JD and weighted 2x. Close these first." items={missMust} icon={<X className="size-4 text-[hsl(var(--bad))]" aria-hidden />} />
          <Bucket title="Missing preferred (nice-to-have)" desc="Preferred or bonus skills, weighted 1x." items={missNice} icon={<AlertTriangle className="size-4 text-[hsl(var(--warn))]" aria-hidden />} />
        </div>
      )}

      {(tips.length > 0 || underused.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {underused.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Repeat className="size-4" aria-hidden /> Emphasized in the JD, light on your resume
                </CardTitle>
                <CardDescription className="text-xs">The employer repeats these, so they carry up to 1.75x weight. Mention each where you actually used it.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {underused.map((m) => (
                    <li key={m.term} className="flex justify-between gap-2 border-b pb-1.5 last:border-0">
                      <span className="font-medium">{m.term}</span>
                      <span className="text-muted-foreground tabular-nums">
                        JD {m.jdCount}× · you {m.resumeCount}×
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {tips.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ALargeSmall className="size-4" aria-hidden /> Acronym + full term
                </CardTitle>
                <CardDescription className="text-xs">Some ATS and recruiters search only one form, so write both once.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {tips.map((m) => (
                    <li key={m.term} className="border-b pb-1.5 last:border-0">
                      <span className="font-medium">{m.term}:</span> <span className="text-muted-foreground">{m.acronymTip}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
