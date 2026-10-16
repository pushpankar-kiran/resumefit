"use client";

import { useMemo, useState } from "react";
import { diffWords } from "diff";
import { AlertTriangle, Copy, FileDown, FileText, Loader2, RefreshCcw, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { classifyHeading } from "@/lib/nlp/resume";
import { toMarkdown } from "@/lib/export";
import type { AnalysisResult } from "@/lib/types";
import { ReportButtons } from "@/components/ReportButtons";
import { isBullet, stripBullet } from "@/lib/nlp/text";

interface Props {
  original: string;
  workingText: string;
  setWorkingText: (t: string) => void;
  onRescore: (text: string) => void;
  rescoring: boolean;
  fileBase: string;
  result?: AnalysisResult;
}

function download(name: string, content: Blob) {
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function toPdf(text: string, name: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 54;
  const W = doc.internal.pageSize.getWidth() - M * 2;
  const H = doc.internal.pageSize.getHeight();
  let y = M;
  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const lines = text.split("\n");
  let first = true;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      y += 6;
      continue;
    }
    if (first) {
      doc.setFont("helvetica", "bold").setFontSize(18);
      ensure(24);
      doc.text(l, M, y + 14);
      y += 26;
      first = false;
      continue;
    }
    if (classifyHeading(l)) {
      ensure(30);
      y += 8;
      doc.setFont("helvetica", "bold").setFontSize(12);
      doc.text(l.replace(/:$/, "").toUpperCase(), M, y + 10);
      y += 14;
      doc.setDrawColor(160).setLineWidth(0.5).line(M, y, M + W, y);
      y += 8;
      continue;
    }
    doc.setFont("helvetica", "normal").setFontSize(10.5);
    const bullet = isBullet(l);
    const body = bullet ? stripBullet(l) : l;
    const indent = bullet ? 14 : 0;
    const wrapped = doc.splitTextToSize(body, W - indent) as string[];
    for (let i = 0; i < wrapped.length; i++) {
      ensure(14);
      if (bullet && i === 0) doc.text("•", M + 3, y + 10);
      doc.text(wrapped[i], M + indent, y + 10);
      y += 14;
    }
  }
  doc.save(name);
}

export function ExportPanel({ original, workingText, setWorkingText, onRescore, rescoring, fileBase, result }: Props) {
  const [view, setView] = useState<"edit" | "diff">("edit");
  const [copied, setCopied] = useState(false);
  const parts = useMemo(() => (view === "diff" ? diffWords(original, workingText) : []), [view, original, workingText]);
  const placeholders = workingText.match(/\[[^\]]{1,40}\]/g) ?? [];
  const changed = original !== workingText;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Tailored resume</CardTitle>
            <CardDescription>Edit freely. Changes from the Rewrite Studio land here.</CardDescription>
          </div>
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {(["edit", "diff"] as const).map((v) => (
              <Button key={v} size="sm" variant={view === v ? "outline" : "ghost"} onClick={() => setView(v)} aria-pressed={view === v}>
                {v === "edit" ? "Edit" : "Changes"}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {view === "edit" ? (
            <Textarea value={workingText} onChange={(e) => setWorkingText(e.target.value)} className="h-[560px] font-mono text-xs leading-relaxed" aria-label="Tailored resume text" />
          ) : (
            <div className="h-[560px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-card p-3 font-mono text-xs leading-relaxed">
              {changed ? (
                parts.map((p, i) =>
                  p.added ? (
                    <ins key={i} className="rounded bg-[hsl(var(--good)/0.2)] no-underline">
                      {p.value}
                    </ins>
                  ) : p.removed ? (
                    <del key={i} className="rounded bg-[hsl(var(--bad)/0.15)] text-muted-foreground">
                      {p.value}
                    </del>
                  ) : (
                    <span key={i}>{p.value}</span>
                  ),
                )
              ) : (
                <p className="font-sans text-sm text-muted-foreground">No changes yet. Apply suggestions in the Rewrite Studio or edit the text.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {result && (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" aria-hidden /> Improve with Claude
              </CardTitle>
              <CardDescription>One Markdown report with every score, knockout, keyword gap, formatting and writing issue, bullet fix, the job description and your resume, plus a ready-made prompt. Paste it into Claude to get a revised resume.</CardDescription>
            </CardHeader>
            <CardContent>
              <ReportButtons result={result} size="sm" />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
            <CardDescription>Plain, single-column, ATS-friendly output: no tables, columns or graphics.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {placeholders.length > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-[hsl(var(--warn)/0.7)] bg-[hsl(var(--warn)/0.12)] p-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {placeholders.length} placeholder{placeholders.length > 1 ? "s" : ""} still to fill in ({[...new Set(placeholders)].slice(0, 3).join(", ")}). Replace them with real numbers before sending.
              </p>
            )}
            <Button className="w-full justify-start" variant="outline" onClick={() => toPdf(workingText, `${fileBase}-ats.pdf`)}>
              <FileDown /> Download PDF
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => download(`${fileBase}-ats.md`, new Blob([toMarkdown(workingText)], { type: "text/markdown" }))}>
              <FileText /> Download Markdown
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => download(`${fileBase}-ats.txt`, new Blob([workingText], { type: "text/plain" }))}>
              <FileText /> Download plain text
            </Button>
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(workingText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* blocked */
                }
              }}
            >
              <Copy /> {copied ? "Copied" : "Copy to clipboard"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Re-score</CardTitle>
            <CardDescription>Run the edited text through the same scoring engine to see the new match score.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => onRescore(workingText)} disabled={rescoring || !changed}>
              {rescoring ? <Loader2 className="animate-spin" /> : <RefreshCcw />} Re-score edited resume
            </Button>
            <Button variant="ghost" onClick={() => setWorkingText(original)} disabled={!changed}>
              <RotateCcw /> Reset
            </Button>
            <p className="w-full text-xs text-muted-foreground">Re-scoring treats the text as a clean single-column document, so layout penalties from the original file no longer apply.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
