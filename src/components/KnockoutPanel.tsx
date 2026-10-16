"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, ScanSearch, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { KnockoutReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import { KNOCKOUT_VERDICT } from "@/lib/nlp/knockouts";

const STATUS = {
  pass: { icon: CheckCircle2, color: "hsl(var(--good))", label: "Pass" },
  risk: { icon: AlertTriangle, color: "hsl(var(--warn))", label: "Borderline" },
  fail: { icon: XCircle, color: "hsl(var(--bad))", label: "Likely knockout" },
  unknown: { icon: CircleHelp, color: "hsl(var(--muted-foreground))", label: "Asked on form" },
  unverifiable: { icon: ScanSearch, color: "hsl(var(--warn))", label: "Unable to verify" },
} as const;

const CONFIDENCE = { high: "High confidence", medium: "Medium confidence", low: "Low confidence: check this yourself" } as const;

/** Yes/no screening filters, shown above the score because one failure overrides any match rate. */
export function KnockoutPanel({ report }: { report: KnockoutReport }) {
  const [open, setOpen] = useState(report.status !== "clear");
  const tone = report.status === "likely-reject" ? "bad" : report.status === "review" || report.status === "unverified" ? "warn" : "good";
  const Icon = report.status === "clear" ? ShieldCheck : ShieldAlert;
  return (
    <Card className={cn(report.status === "likely-reject" && "border-[hsl(var(--bad)/0.5)]", (report.status === "review" || report.status === "unverified") && "border-[hsl(var(--warn)/0.7)]")}>
      <CardHeader className="pb-3">
        <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon className="mt-0.5 size-5 shrink-0" style={{ color: `hsl(var(--${tone}))` }} aria-hidden />
          <div className="flex-1">
            <CardTitle className="text-base">
              Knockout screen:{" "}
              {KNOCKOUT_VERDICT[report.status]}
            </CardTitle>
            <CardDescription className="mt-1">
              {report.parseConfidence ? `Parse confidence: ${report.parseConfidence}. ` : ""}
              {report.summary} These are yes/no filters, so they aren&apos;t part of the 0–100 score.</CardDescription>
          </div>
          <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </CardHeader>
      {open && report.checks.length > 0 && (
        <CardContent>
          <ul className="divide-y">
            {report.checks.map((c) => {
              const s = STATUS[c.status];
              const SIcon = s.icon;
              return (
                <li key={c.id} className="grid gap-1 py-3 sm:grid-cols-[1.2fr_2fr]">
                  <div className="flex items-start gap-2">
                    <SIcon className="mt-0.5 size-4 shrink-0" style={{ color: s.color }} aria-hidden />
                    <div>
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.status === "fail" && c.confidence === "low" ? "Possible knockout" : s.label} · {CONFIDENCE[c.confidence]}
                      </p>
                    </div>
                  </div>
                  <div className="text-sm">
                    <p>
                      <span className="text-muted-foreground">JD: </span>
                      {c.requirement}
                    </p>
                    <p>
                      <span className="text-muted-foreground">You: </span>
                      {c.candidate}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.advice}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
