"use client";

import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { FileText, Loader2, Sparkles, Upload, X, ClipboardPaste, Wand2, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SAMPLES } from "@/lib/samples";
import { cn } from "@/lib/utils";

const ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
};
const MAX = 5 * 1024 * 1024;

export interface InputState {
  resumeFile: File | null;
  resumeText: string;
  resumeName: string;
  jdText: string;
  jdFile: File | null;
  useLLM: boolean;
}

interface Props {
  llmAvailable: boolean;
  loading: boolean;
  onAnalyze: (s: InputState) => void;
}

function DropArea({
  label,
  hint,
  file,
  onFile,
  onClear,
  compact,
}: {
  label: string;
  hint: string;
  file: File | null;
  onFile: (f: File) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const [err, setErr] = useState<string | null>(null);
  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setErr(null);
      if (rejected.length) {
        const code = rejected[0].errors[0]?.code;
        setErr(code === "file-too-large" ? "File is larger than 5 MB." : "Use a PDF, DOCX or TXT file.");
        return;
      }
      if (accepted[0]) onFile(accepted[0]);
    },
    [onFile],
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: ACCEPT, maxSize: MAX, multiple: false });

  if (file)
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClear} aria-label={`Remove ${file.name}`}>
          <X />
        </Button>
      </div>
    );

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 text-center transition-colors",
          compact ? "py-4" : "py-8",
          isDragActive ? "border-primary bg-accent" : "border-input hover:border-primary/60 hover:bg-muted/50",
        )}
      >
        <input {...getInputProps()} aria-label={label} />
        <Upload className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{isDragActive ? "Drop it here" : label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {err && <p className="mt-2 text-xs text-[hsl(var(--bad))]">{err}</p>}
    </div>
  );
}

export function InputPanel({ llmAvailable, loading, onAnalyze }: Props) {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [resumeName, setResumeName] = useState("pasted-resume.txt");
  const [pasteMode, setPasteMode] = useState(false);
  const [jdText, setJdText] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [useLLM, setUseLLM] = useState(true);

  const loadSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)!;
    setResumeFile(null);
    setPasteMode(true);
    setResumeText(s.resume);
    setResumeName(s.resumeName);
    setJdFile(null);
    setJdText(s.jd);
  };

  const hasResume = !!resumeFile || resumeText.trim().length > 0;
  const hasJD = jdText.trim().length > 0 || !!jdFile;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Quick-fill sample:</span>
        {SAMPLES.map((s) => (
          <Button key={s.id} variant="outline" size="sm" onClick={() => loadSample(s.id)}>
            <Wand2 /> {s.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden /> Resume
            </CardTitle>
            <CardDescription>PDF, DOCX or TXT up to 5 MB, or paste the text.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!pasteMode ? (
              <DropArea
                label="Drag & drop your resume, or click to browse"
                hint="We read layout too: columns, tables, headers/footers"
                file={resumeFile}
                onFile={(f) => {
                  setResumeFile(f);
                  setResumeText("");
                }}
                onClear={() => setResumeFile(null)}
              />
            ) : (
              <Textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste your resume text here…"
                className="h-64 font-mono text-xs"
                aria-label="Resume text"
              />
            )}
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => {
                setPasteMode(!pasteMode);
                if (!pasteMode) setResumeFile(null);
              }}
            >
              <ClipboardPaste /> {pasteMode ? "Upload a file instead" : "Paste text instead"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="size-4 text-primary" aria-hidden /> Job description
            </CardTitle>
            <CardDescription>Paste the full posting, or drop a file. Optional: leave it empty for a general resume score.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {jdFile ? (
              <DropArea label="" hint="" file={jdFile} onFile={setJdFile} onClear={() => setJdFile(null)} />
            ) : (
              <>
                <Textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  placeholder="Paste the job description here…"
                  className="h-48 text-xs"
                  aria-label="Job description text"
                />
                <DropArea compact label="…or drop a JD file" hint="PDF, DOCX or TXT" file={null} onFile={setJdFile} onClear={() => {}} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className={cn("flex items-center gap-2 text-sm", !llmAvailable && "text-muted-foreground")}>
          <input
            type="checkbox"
            className="size-4 accent-[hsl(var(--primary))]"
            checked={useLLM && llmAvailable}
            disabled={!llmAvailable}
            onChange={(e) => setUseLLM(e.target.checked)}
          />
          <Sparkles className="size-4" aria-hidden />
          {llmAvailable ? "Use Claude for JD structuring, semantic matching & rewrites" : "Running locally with the built-in engine (free). Optional Claude mode: set ATS_AI=claude in .env.local"}
        </label>
        <Button
          size="lg"
          disabled={!hasResume || loading}
          onClick={() => onAnalyze({ resumeFile, resumeText, resumeName, jdText, jdFile, useLLM: useLLM && llmAvailable })}
        >
          {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {loading ? "Analyzing…" : hasJD ? "Analyze match" : "Get general score"}
        </Button>
      </div>
    </div>
  );
}
