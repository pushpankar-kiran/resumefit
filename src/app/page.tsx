"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Download, Eye, FileSearch, Gauge, Info, ScanSearch, SpellCheck, Tags, Wand2, XCircle } from "lucide-react";
import { InputPanel, type InputState } from "@/components/InputPanel";
import { Overview } from "@/components/Overview";
import { KeywordMatrix } from "@/components/KeywordMatrix";
import { FormattingAudit } from "@/components/FormattingAudit";
import { ContentQuality } from "@/components/ContentQuality";
import { AtsViewPanel } from "@/components/AtsViewPanel";
import { RewriteStudio } from "@/components/RewriteStudio";
import { ExportPanel } from "@/components/ExportPanel";
import { ReportButtons } from "@/components/ReportButtons";
import { AutoTailor } from "@/components/AutoTailor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AnalysisResult } from "@/lib/types";

interface ApiError {
  code: string;
  message: string;
}

export default function Home() {
  const [llm, setLlm] = useState<{ llm: boolean; model: string | null }>({ llm: false, model: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  // The analysis of the resume as uploaded; auto-tailor always starts from it.
  const [baseResult, setBaseResult] = useState<AnalysisResult | null>(null);
  const [prevScore, setPrevScore] = useState<number | null>(null);
  const [original, setOriginal] = useState("");
  const [working, setWorking] = useState("");
  const [tab, setTab] = useState("overview");
  const [rescoring, setRescoring] = useState(false);
  // The uploaded resume file is kept so auto-tailor can return it in its original format (.docx).
  const lastInput = useRef<{ jd: string; jdFile: File | null; useLLM: boolean; resumeFile: File | null } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setLlm({ llm: !!d.llm, model: d.model }))
      .catch(() => {});
  }, []);

  async function post(form: FormData): Promise<AnalysisResult> {
    const res = await fetch("/api/analyze", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw (data?.error as ApiError) ?? { code: "NETWORK", message: "The server didn't respond. Try again." };
    return data as AnalysisResult;
  }

  async function onAnalyze(s: InputState) {
    setLoading(true);
    setError(null);
    const form = new FormData();
    if (s.resumeFile) form.append("resume", s.resumeFile);
    else {
      form.append("resumeText", s.resumeText);
      form.append("resumeName", s.resumeName);
    }
    if (s.jdFile && !s.jdText.trim()) form.append("jdFile", s.jdFile);
    else form.append("jd", s.jdText);
    form.append("useLLM", String(s.useLLM));
    lastInput.current = { jd: s.jdText, jdFile: s.jdText.trim() ? null : s.jdFile, useLLM: s.useLLM, resumeFile: s.resumeFile };
    try {
      const r = await post(form);
      setResult(r);
      setBaseResult(r);
      setPrevScore(null);
      setOriginal(r.resume.text);
      setWorking(r.resume.text);
      setTab("overview");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }

  async function onRescore(text: string, keepTab = false) {
    if (!lastInput.current || !result) return;
    setRescoring(true);
    const form = new FormData();
    form.append("resumeText", text);
    form.append("resumeName", result.resume.fileName.replace(/\.\w+$/, "").replace(/(-tailored)+$/, "") + "-tailored.txt");
    if (lastInput.current.jdFile) form.append("jdFile", lastInput.current.jdFile);
    else form.append("jd", lastInput.current.jd);
    form.append("useLLM", String(lastInput.current.useLLM));
    try {
      const r = await post(form);
      setPrevScore(result.overallScore);
      setResult(r);
      if (!keepTab) setTab("overview");
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setRescoring(false);
    }
  }

  function replace(orig: string, next: string): boolean {
    if (!working.includes(orig)) return false;
    setWorking(working.replace(orig, next.replace(/\s+$/, "")));
    return true;
  }

  return (
    <main className="container max-w-7xl py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ScanSearch className="size-6 text-primary" aria-hidden /> ATS Resume Analyzer
          </h1>
          <p className="text-sm text-muted-foreground">Score a resume against a job description, find what an ATS will miss, and fix it.</p>
        </div>
        {result && (
          <div className="flex flex-wrap items-center gap-2">
            <ReportButtons result={result} />
            <Button variant="ghost" onClick={() => setResult(null)}>
              <ArrowLeft /> New analysis
            </Button>
          </div>
        )}
      </header>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-lg border border-[hsl(var(--bad)/0.5)] bg-[hsl(var(--bad)/0.08)] p-4"
          >
            <XCircle className="mt-0.5 size-5 shrink-0 text-[hsl(var(--bad))]" aria-hidden />
            <div className="flex-1">
              <p className="text-sm font-medium">{error.code === "SCANNED_PDF" ? "Scanned PDF detected: OCR needed" : "Couldn't analyze"}</p>
              <p className="text-sm text-muted-foreground">{error.message}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {!result ? (
        <InputPanel llmAvailable={llm.llm} loading={loading} onAnalyze={onAnalyze} />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <strong className="text-foreground">{result.resume.fileName}</strong> · {result.resume.totalYears} yrs experience detected · {result.resume.roles.length} roles
            </span>
            <span className="flex items-center gap-1">
              <Info className="size-3.5" aria-hidden /> Engine: {result.engine.llm ? `Claude (${result.engine.model}) + rules` : "built-in NLP rules"}
            </span>
            {prevScore !== null && (
              <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">
                Re-scored: {prevScore} → {result.overallScore} ({result.overallScore - prevScore >= 0 ? "+" : ""}
                {result.overallScore - prevScore})
              </span>
            )}
          </div>

          {[...result.warnings, ...result.engine.notes].length > 0 && (
            <ul className="space-y-1.5">
              {[...result.warnings, ...result.engine.notes].map((w) => (
                <li key={w} className="flex items-start gap-2 rounded-md border border-[hsl(var(--warn)/0.7)] bg-[hsl(var(--warn)/0.1)] px-3 py-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">
                <Gauge aria-hidden /> Overview
              </TabsTrigger>
              <TabsTrigger value="keywords" disabled={result.mode === "general"} title={result.mode === "general" ? "Add a job description to see keyword gaps" : undefined}>
                <Tags aria-hidden /> Keyword Analysis
              </TabsTrigger>
              <TabsTrigger value="format">
                <FileSearch aria-hidden /> Formatting Audit
              </TabsTrigger>
              <TabsTrigger value="content">
                <SpellCheck aria-hidden /> Content Quality
              </TabsTrigger>
              <TabsTrigger value="ats">
                <Eye aria-hidden /> ATS View
              </TabsTrigger>
              <TabsTrigger value="rewrite">
                <Wand2 aria-hidden /> Rewrite &amp; Auto-tailor
              </TabsTrigger>
              <TabsTrigger value="export">
                <Download aria-hidden /> Export
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <Overview result={result} />
            </TabsContent>
            <TabsContent value="keywords">
              <KeywordMatrix result={result} />
            </TabsContent>
            <TabsContent value="format">
              <FormattingAudit result={result} />
            </TabsContent>
            <TabsContent value="content">
              <ContentQuality result={result} />
            </TabsContent>
            <TabsContent value="ats">
              <AtsViewPanel result={result} />
            </TabsContent>
            {/* Kept mounted so the auto-tailor review and rewrite options survive tab switches. */}
            <TabsContent value="rewrite" forceMount className="data-[state=inactive]:hidden">
              <div className="space-y-5">
                <AutoTailor
                  baseResult={baseResult ?? result}
                  result={result}
                  original={original}
                  workingText={working}
                  rescoring={rescoring}
                  onApply={async (text) => {
                    setWorking(text);
                    await onRescore(text, true);
                  }}
                  onOpenExport={() => setTab("export")}
                  sourceFile={lastInput.current?.resumeFile ?? null}
                />
                <RewriteStudio result={result} workingText={working} onReplace={replace} useLLM={!!lastInput.current?.useLLM} />
              </div>
            </TabsContent>
            <TabsContent value="export">
              <ExportPanel
                original={original}
                workingText={working}
                setWorkingText={setWorking}
                onRescore={onRescore}
                rescoring={rescoring}
                result={result}
                fileBase={result.resume.fileName.replace(/\.\w+$/, "").replace(/-tailored$/, "") || "resume"}
              />
            </TabsContent>
          </Tabs>
        </motion.div>
      )}
    </main>
  );
}
