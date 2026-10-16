"use client";

import { CheckCircle2, Eye, Info, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult } from "@/lib/types";
import { ScoreGauge } from "@/components/Overview";

export function AtsViewPanel({ result }: { result: AnalysisResult }) {
  const v = result.atsView;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader>
            <CardTitle>ATS parse rate</CardTitle>
            <CardDescription>Share of the fields a recruiter searches on that survive a basic ATS read: straight across the page, ignoring headers, footers and hyperlinks.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreGauge score={v.parseRate} label="ATS parse rate" />
            {v.notes.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {v.notes.map((n) => (
                  <li key={n} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {n}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-4" aria-hidden /> What the ATS extracts
            </CardTitle>
            <CardDescription>The candidate profile an ATS would build from your file.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <tbody>
                {v.fields.map((f) => (
                  <tr key={f.label} className="border-b last:border-0">
                    <td className="w-8 py-2 pl-5">
                      {f.ok ? <CheckCircle2 className="size-4 text-[hsl(var(--good))]" aria-label="Parsed" /> : <XCircle className="size-4 text-[hsl(var(--bad))]" aria-label="Missing" />}
                    </td>
                    <td className="py-2 pr-3 font-medium">{f.label}</td>
                    <td className="py-2 pr-5">
                      {f.value ?? <span className="text-muted-foreground">—</span>}
                      {f.note && <p className="text-xs text-muted-foreground">{f.note}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sections as mapped</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {v.sections.map((s, i) => (
                <li key={i} className="flex justify-between gap-2 border-b pb-1 last:border-0">
                  <span className="truncate">{s.heading}</span>
                  <span className={s.mappedTo === "unmapped" || !s.standard ? "text-[hsl(var(--bad))]" : "text-muted-foreground"}>→ {s.mappedTo}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Work history as parsed</CardTitle>
          </CardHeader>
          <CardContent>
            {v.roles.length ? (
              <ul className="space-y-2 text-sm">
                {v.roles.map((r, i) => (
                  <li key={i} className="border-b pb-2 last:border-0">
                    <p className="font-medium">{r.title || <span className="text-[hsl(var(--bad))]">(no title found)</span>}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.company || "(no employer found)"} · {r.dates ?? "(no dates)"} · {r.bullets} bullet{r.bullets === 1 ? "" : "s"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No roles could be read.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Skills & education as parsed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{v.skills.length ? v.skills.join(", ") : <span className="text-muted-foreground">No skills recognized in a Skills section.</span>}</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {v.education.length ? v.education.map((e) => <li key={e}>{e}</li>) : <li>No degree recognized.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Plain-text reading order</CardTitle>
          <CardDescription className="text-xs">Exactly the text, in order, that a basic parser reads. If lines from different columns run together here, that&apos;s what the ATS stores.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{v.naiveText}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
