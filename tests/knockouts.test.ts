import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analyze";
import { parseText } from "@/lib/parsers";
import { SAMPLES } from "@/lib/samples";

const STRICT = `Senior Data Engineer
Location: Washington, DC (on-site, 4 days a week)

Requirements
- 7+ years of data engineering experience
- Bachelor's degree in Computer Science or Engineering required
- Active Top Secret clearance required
- Must be a U.S. citizen. We are unable to sponsor visas.
- AWS Certified Solutions Architect certification required
- Fluency in Spanish required
- Build ETL pipelines in Python and SQL on AWS`;

const run = (resume: string, jd: string) => analyze(parseText(resume, "r.txt"), jd, { useLLM: false });
const status = (r: Awaited<ReturnType<typeof run>>, id: string) => r.knockouts?.checks.find((c) => c.id === id)?.status;

describe("knockout screening", () => {
  it("clears the samples against their own JDs", async () => {
    for (const s of SAMPLES) expect((await run(s.resume, s.jd)).knockouts?.status).toBe("clear");
  });

  it("flags every hard filter in a strict posting", async () => {
    const resume = SAMPLES[0].resume.replace("Austin, TX", "Austin, TX | H-1B (requires sponsorship)");
    const r = await run(resume, STRICT);
    expect(r.knockouts?.status).toBe("likely-reject");
    expect(status(r, "authorization")).toBe("fail");
    expect(status(r, "clearance")).toBe("fail");
    expect(status(r, "cert-AWS Certified Solutions Architect")).toBe("fail");
    expect(status(r, "lang-spanish")).toBe("fail");
    expect(status(r, "location")).toBe("risk"); // same country, different city, on-site
    expect(status(r, "years")).toBe("pass");
    expect(status(r, "degree")).toBe("pass");
  });

  it("passes requirements the resume meets", async () => {
    const resume = SAMPLES[0].resume
      .replace("Austin, TX", "Washington, DC | U.S. Citizen | Active TS/SCI clearance")
      .replace("SKILLS", "CERTIFICATIONS\nAWS Certified Solutions Architect – Associate, 2024\n\nLANGUAGES\nSpanish (fluent)\n\nSKILLS");
    const r = await run(resume, STRICT);
    for (const id of ["authorization", "clearance", "cert-AWS Certified Solutions Architect", "lang-spanish", "location"]) expect(status(r, id), id).toBe("pass");
  });

  it("treats unstated authorization as a form question, not a failure", async () => {
    const r = await run(SAMPLES[0].resume, SAMPLES[0].jd + "\n\nYou must be authorized to work in the United States. We do not offer visa sponsorship.");
    expect(status(r, "authorization")).toBe("unknown");
  });

  it("flags a country mismatch", async () => {
    const r = await run(SAMPLES[0].resume.replace("Austin, TX", "Pune, India"), SAMPLES[0].jd.replace("We're a remote-first company", "Location: London, United Kingdom (hybrid). We're a company"));
    expect(status(r, "location")).toBe("fail");
  });

  it("is skipped in general mode", async () => {
    expect((await run(SAMPLES[0].resume, "")).knockouts).toBeNull();
  });
});
