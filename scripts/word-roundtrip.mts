// Proof for "no extra lines": tailor Word files aggressively, then compare Word's own layout.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { analyze } from "../src/lib/analyze";
import { parseResumeFile } from "../src/lib/parsers";
import { tailorDocx } from "../src/lib/docx-edit";
import { DEFAULT_OPTIONS, planTailoring } from "../src/lib/tailor";
import { SAMPLES } from "../src/lib/samples";

const out = process.argv[2];
const files = ["fixtures/templates/docx/word-classic.docx", "fixtures/templates/docx/word-header-contact.docx", "fixtures/resume-risky.docx", "fixtures/templates/docx/word-needs-work.docx"];
for (const f of files) {
  const buf = readFileSync(f);
  const jd = f.includes("needs-work") ? SAMPLES[1].jd : SAMPLES[0].jd;
  const r = await analyze(await parseResumeFile(buf, path.basename(f)), jd, { useLLM: false });
  const plan = planTailoring(r, { ...DEFAULT_OPTIONS, metricPlaceholders: true, weaveKeywords: true, addKeywords: ["Docker", "GraphQL", "Kubernetes", "Microservices", "Terraform", "Kafka", "Redis", "OKRs", "Mixpanel", "Amplitude", "Looker"] });
  const res = await tailorDocx(buf, plan);
  const base = path.basename(f, ".docx");
  copyFileSync(f, path.join(out, `${base}.docx`));
  writeFileSync(path.join(out, `${base}-tailored.docx`), res.buffer);
  console.log(`${base}: ${res.applied.length} applied in Word file, ${plan.filter((c) => c.blocked).length} held back, not found: ${res.notFound.length}`);
}
