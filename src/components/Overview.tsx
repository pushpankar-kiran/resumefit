"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { AlertTriangle, CheckCircle2, ChevronDown, Code2, FileCheck2, LayoutList, ListChecks, PenLine, TrendingUp, XCircle, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult, CategoryScores } from "@/lib/types";
import { bandOf, cn } from "@/lib/utils";
import { KnockoutPanel } from "@/components/KnockoutPanel";

type MetaKey = keyof CategoryScores | "writingQuality";

export const CATEGORY_META: { key: MetaKey; label: string; icon: typeof Code2 }[] = [
  { key: "hardSkills", label: "Hard Skills & Tools", icon: Code2 },
  { key: "experienceAlignment", label: "Experience Alignment", icon: TrendingUp },
  { key: "sectionStructure", label: "Section Structure", icon: LayoutList },
  { key: "formattingHealth", label: "Formatting & Parse Health", icon: FileCheck2 },
  { key: "bulletImpact", label: "Bullet Impact", icon: Zap },
  { key: "writingQuality", label: "Writing Quality", icon: PenLine },
];

function scoreOf(result: AnalysisResult, key: MetaKey): number | null {
  return key === "writingQuality" ? result.writing.score : result.categoryScores[key];
}

function BandIcon({ score, className }: { score: number; className?: string }) {
  const b = bandOf(score).band;
  const Icon = b === "high" ? CheckCircle2 : b === "moderate" ? AlertTriangle : XCircle;
  return <Icon className={className} style={{ color: bandOf(score).color }} aria-hidden />;
}

/** Semicircle gauge: a single headline number, status-colored with icon + label. */
export function ScoreGauge({ score, label: aria = "Overall match score" }: { score: number; label?: string }) {
  const { label, color } = bandOf(score);
  const r = 80;
  const c = Math.PI * r;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-full max-w-[280px]" role="img" aria-label={`${aria} ${score} out of 100, ${label}`}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="hsl(var(--muted))" strokeWidth="16" strokeLinecap="round" />
        <motion.path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
        {/* Band thresholds at 60 and 75 */}
        {[60, 75].map((t) => {
          const a = Math.PI * (1 - t / 100);
          return <line key={t} x1={100 + 64 * Math.cos(a)} y1={100 - 64 * Math.sin(a)} x2={100 + 70 * Math.cos(a)} y2={100 - 70 * Math.sin(a)} stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" />;
        })}
        <text x="100" y="88" textAnchor="middle" className="fill-foreground" style={{ fontSize: 40, fontWeight: 700 }}>
          {score}
        </text>
        <text x="100" y="108" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
          out of 100
        </text>
      </svg>
      <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
        <BandIcon score={score} className="size-4" />
        {label}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">0–59 low · 60–74 moderate · 75–100 high</p>
    </div>
  );
}

function CategoryCard({ meta, result }: { meta: (typeof CATEGORY_META)[number]; result: AnalysisResult }) {
  const [open, setOpen] = useState(false);
  const score = scoreOf(result, meta.key);
  const weight = result.weights[meta.key];
  const pts = score === null ? null : Math.round(((score * weight) / 100) * 10) / 10;
  const Icon = meta.icon;
  return (
    <Card className={cn("flex flex-col", score === null && "opacity-70")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            {meta.label}
          </div>
          {score !== null && <BandIcon score={score} className="size-4 shrink-0" />}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {score === null ? (
          <p className="text-sm text-muted-foreground">Add a job description to score this.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <span className="ml-auto text-right text-xs text-muted-foreground tabular-nums">{weight ? `${pts} of ${weight} pts` : "advisory"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
              <motion.div className="h-full rounded-full" style={{ background: bandOf(score).color }} initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.8 }} />
            </div>
          </>
        )}
        <button className="mt-auto flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden /> How this was scored
        </button>
        {open && (
          <ul className="space-y-1 text-xs">
            {result.explanations[meta.key].map((e, i) => (
              <li key={i} className="flex justify-between gap-2 border-t pt-1">
                <span className="text-muted-foreground">{e.label}</span>
                <span className="text-right font-medium">{e.value}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RadarBreakdown({ result }: { result: AnalysisResult }) {
  const data = CATEGORY_META.filter((m) => scoreOf(result, m.key) !== null).map((m) => ({
    category: m.label.replace(" & Parse Health", "").replace(" & Tools", ""),
    score: scoreOf(result, m.key),
  }));
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey="category" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tickCount={5} tick={false} axisLine={false} />
          <Radar dataKey="score" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.18} dot={{ r: 4, fill: "var(--series-1)", stroke: "hsl(var(--card))", strokeWidth: 2 }} isAnimationActive />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" }}
            formatter={(v: number) => [`${v} / 100`, "Score"]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Overview({ result }: { result: AnalysisResult }) {
  const k = result.keywords;
  const highIssues = result.formattingIssues.filter((i) => i.severity === "high").length;
  const general = result.mode === "general";
  return (
    <div className="space-y-5">
      {result.knockouts && <KnockoutPanel report={result.knockouts} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>{general ? "General resume score" : "Overall match score"}</CardTitle>
            <CardDescription>
              {general
                ? "No job description: structure, formatting, bullet impact and writing quality only"
                : `${result.jd.targetTitle ? `vs. "${result.jd.targetTitle}"` : "vs. the job description"} · weighted across 5 categories`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreGauge score={result.overallScore} label={general ? "General resume score" : "Overall match score"} />
            <dl className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-muted p-2">
                <dt className="text-muted-foreground">{general ? "ATS parse rate" : "Keywords matched"}</dt>
                <dd className="text-lg font-semibold tabular-nums">{general ? `${result.atsView.parseRate}%` : `${k.matched.length}/${k.details.length}`}</dd>
              </div>
              <div className="rounded-md bg-muted p-2">
                <dt className="text-muted-foreground">{general ? "Writing issues" : "Missing must-haves"}</dt>
                <dd className="text-lg font-semibold tabular-nums">{general ? result.writing.issues.length : k.missingMustHave.length}</dd>
              </div>
              <div className="rounded-md bg-muted p-2">
                <dt className="text-muted-foreground">High-risk format issues</dt>
                <dd className="text-lg font-semibold tabular-nums">{highIssues}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4" aria-hidden /> Category profile
            </CardTitle>
            <CardDescription>Each axis is that category&apos;s 0–100 score before weighting.</CardDescription>
          </CardHeader>
          <CardContent>
            <RadarBreakdown result={result} />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORY_META.map((m) => (
          <CategoryCard key={m.key} meta={m} result={result} />
        ))}
      </div>
      {!general && <p className="text-xs text-muted-foreground">Writing Quality is advisory in match mode, like Jobscan&apos;s recruiter tips: it doesn&apos;t change the match score.</p>}
    </div>
  );
}
