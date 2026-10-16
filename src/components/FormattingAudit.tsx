"use client";

import { AlertTriangle, CheckCircle2, Columns2, FileSearch, FileText, ListOrdered, Type, UserRound, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult, DiagnosticCheck } from "@/lib/types";

const STATUS = {
  pass: { icon: CheckCircle2, color: "hsl(var(--good))", label: "Pass" },
  warn: { icon: AlertTriangle, color: "hsl(var(--warn))", label: "Warning" },
  fail: { icon: XCircle, color: "hsl(var(--bad))", label: "Fail" },
} as const;

// Check ids grouped the way recruiters think about them.
const GROUPS: { title: string; icon: typeof Type; ids: (id: string) => boolean }[] = [
  { title: "Parse test", icon: Columns2, ids: (id) => ["columns", "tables", "text-boxes", "images", "hidden-text", "special-chars", "icon-font"].includes(id) },
  { title: "Typography & page setup", icon: Type, ids: (id) => ["fonts", "font-size", "bold", "color", "page-size", "margins"].includes(id) },
  { title: "Contact & web presence", icon: UserRound, ids: (id) => id.startsWith("contact-") || ["email-quality", "web-presence", "link-text"].includes(id) },
  { title: "Structure, dates & order", icon: ListOrdered, ids: (id) => id.startsWith("section-") || ["dates", "chronology", "stuffing"].includes(id) },
  { title: "File & length", icon: FileText, ids: (id) => id.startsWith("file") || id === "word-count" },
];

function CheckRow({ c }: { c: DiagnosticCheck }) {
  const s = STATUS[c.status];
  const Icon = s.icon;
  return (
    <li className="flex items-start gap-3 border-b py-2.5 last:border-0">
      <Icon className="mt-0.5 size-4 shrink-0" style={{ color: s.color }} aria-label={s.label} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{c.label}</p>
        <p className="break-words text-xs text-muted-foreground">{c.detail}</p>
      </div>
      <span className="text-xs text-muted-foreground">{s.label}</span>
    </li>
  );
}

export function FormattingAudit({ result }: { result: AnalysisResult }) {
  const L = result.resume.layout;
  const sev = { high: "bad", medium: "warn", low: "secondary" } as const;
  const total = result.diagnostics.length;
  const passed = result.diagnostics.filter((d) => d.status === "pass").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Card className="lg:self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="size-4" aria-hidden /> Issues & fixes
          </CardTitle>
          <CardDescription>
            {passed} of {total} checks passed. Findings are grouped by root cause, so one problem is listed (and penalised, up to a cap) once. Sorted by severity: the high-severity items most affect whether an ATS can read you at all.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.formattingIssues.length ? (
            <ul className="space-y-3">
              {result.formattingIssues.map((i) => (
                <li key={i.id + i.issue} className="rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Badge variant={sev[i.severity]} className="shrink-0 uppercase">
                      {i.severity === "high" ? <XCircle aria-hidden /> : <AlertTriangle aria-hidden />}
                      {i.severity}
                    </Badge>
                    <p className="text-sm font-medium">{i.issue}</p>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{i.recommendation}</p>
                  {i.items && i.items.length > 1 && (
                    <ul className="mt-2 space-y-1 border-l-2 pl-3">
                      {i.items.map((x) => (
                        <li key={x.id + x.issue} className="text-xs">
                          <span className="font-medium">{x.issue}</span>
                          {x.recommendation && x.recommendation !== i.recommendation ? <span className="text-muted-foreground"> {x.recommendation}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-[hsl(var(--good))]" aria-hidden /> No formatting or structure issues found.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {GROUPS.map((g) => {
          const rows = result.diagnostics.filter((d) => g.ids(d.id));
          if (!rows.length) return null;
          const Icon = g.icon;
          const bad = rows.filter((r) => r.status !== "pass").length;
          return (
            <Card key={g.title}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Icon className="size-4" aria-hidden /> {g.title}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{bad ? `${bad} to review` : "all clear"}</span>
                </CardTitle>
                {g.title === "Parse test" && (
                  <CardDescription className="text-xs">
                    {result.resume.fileType.toUpperCase()} · {L.pageCount} page{L.pageCount > 1 ? "s" : ""} · {L.columns} column{L.columns > 1 ? "s" : ""} · {L.imageCount} image{L.imageCount === 1 ? "" : "s"}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <ul>
                  {rows.map((c) => (
                    <CheckRow key={c.id} c={c} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
