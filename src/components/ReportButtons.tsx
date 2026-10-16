"use client";

import { useState } from "react";
import { Check, ClipboardCopy, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisResult } from "@/lib/types";
import { buildClaudeReport, reportFileName } from "@/lib/report";
import { cn } from "@/lib/utils";

/** Copy / download the full findings as one Markdown file with a ready-made prompt for Claude. */
export function ReportButtons({ result, className, size = "default" }: { result: AnalysisResult; className?: string; size?: "default" | "sm" }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  // Keep-layout mode: the prompt asks for word swaps only (no restructure, no added words).
  const [keepLayout, setKeepLayout] = useState(false);
  const report = () => buildClaudeReport(result, undefined, { keepLayout });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true); // clipboard blocked: the download still works
    }
  };

  const download = () => {
    const blob = new Blob([report()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = reportFileName(result);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button size={size} onClick={copy} title="Copies the full report with a ready-made prompt; paste it into Claude">
        {copied ? <Check /> : <ClipboardCopy />} {copied ? "Copied: paste into Claude" : "Copy report for Claude"}
      </Button>
      <Button size={size} variant="outline" onClick={download} title="Downloads the same report as a Markdown (.md) file">
        <FileDown /> Download report (.md)
      </Button>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="The prompt asks Claude for a list of word swaps only: no single-column rewrite, and the word count can't go up">
        <input type="checkbox" checked={keepLayout} onChange={(e) => setKeepLayout(e.target.checked)} /> Keep my layout (word swaps only)
      </label>
      {failed && <span className="text-xs text-[hsl(var(--bad))]">Clipboard blocked: use Download instead.</span>}
    </div>
  );
}
