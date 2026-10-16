import type { ParsedResume, WritingIssue, WritingIssueKind, WritingReport } from "../types";
import { SKILLS } from "./skills";
import { isBullet, stripBullet } from "./text";
import { firstWord } from "./verbs";

// Writing-quality checks a recruiter notices: spelling, grammar, repetition, buzzwords,
// filler and tone. Everything runs locally (Hunspell dictionary via nspell); resume text is
// never sent to a third-party grammar service.

type Speller = { correct: (w: string) => boolean; suggest: (w: string) => string[] };
let spellerPromise: Promise<Speller | null> | null = null;

async function getSpeller(): Promise<Speller | null> {
  if (!spellerPromise) {
    spellerPromise = (async () => {
      try {
        const [{ default: nspell }, { default: dict }] = await Promise.all([import("nspell"), import("dictionary-en")]);
        const sp = nspell(dict as unknown as { aff: Buffer; dic: Buffer });
        // Teach it the skill taxonomy and common resume/tech vocabulary.
        for (const s of SKILLS) for (const v of [s.term, ...s.aliases]) for (const w of v.split(/[\s/]+/)) if (/^[A-Za-z][A-Za-z'-]+$/.test(w)) sp.add(w);
        for (const w of EXTRA_WORDS) sp.add(w);
        return sp as Speller;
      } catch {
        return null;
      }
    })();
  }
  return spellerPromise;
}

const EXTRA_WORDS = (
  "backend frontend fullstack microservice microservices onboarding offboarding dashboarding upskilled upskill " +
  "stakeholders stakeholder roadmap roadmaps roadmapping workflow workflows datasets dataset runbook runbooks " +
  "scalable scalability performant containerized containerize deployable APIs API SDK SDKs UI UX CI CD QA SaaS " +
  "B2B B2C KPI KPIs OKR OKRs ROI SLA SLAs SQL NoSQL ETL ELT LLM LLMs GenAI analytics hackathon hackathons " +
  "e-commerce ecommerce omnichannel cross-functional cross-functionally pre-sales presales go-to-market " +
  "subject-matter end-to-end real-time multi-tenant opensource open-source codebase codebases refactored " +
  "refactor refactoring debugged prototyped productionized productized monetization monetize gamification " +
  "LinkedIn GitHub GitLab YouTube iOS macOS Gmail Wi-Fi WiFi email emails startup startups fintech healthtech " +
  "edtech proptech insurtech teammate teammates mentee mentees standup standups"
)
  .split(/\s+/)
  .filter(Boolean);

// Tool, product and company names a general dictionary doesn't know. Never flagged as misspellings.
export const BRAND_ALLOWLIST = (
  "esports e-sports netlify vercel heroku firebase supabase confluence jira asana trello notion figma miro canva " +
  "tableau powerbi salesforce hubspot zendesk freshdesk freshworks mixpanel amplitude hotjar zapier airtable slack " +
  "postman swagger shopify wordpress webflow razorpay paytm phonepe swiggy zomato flipkart myntra zepto blinkit " +
  "infosys wipro accenture deloitte cognizant capgemini mckinsey kpmg servicenow workday snowflake databricks dbt " +
  "looker metabase grafana kibana splunk datadog pagerduty kubernetes terraform ansible jenkins bitbucket kaggle " +
  "chatgpt openai anthropic gemini copilot langchain llamaindex pinecone huggingface midjourney scrum kanban " +
  "sharepoint onedrive powerpoint visio webex calendly typeform surveymonkey qualtrics gainsight intercom pendo " +
  "optimizely snowplow bigquery redshift postgres mongodb redis kafka aiops mlops devops finops devsecops upsell " +
  "upselling cross-sell onboarded deduplication dedupe geospatial hyperlocal kyc upi nbfc quickcommerce " +
  "q-commerce odoo gamified playtesting gameplay livestream livestreaming influencer influencers creator creators"
)
  .split(/\s+/)
  .filter(Boolean);

/** British spellings (optimised, programme, behaviour) are correct; accept them when the US form is. */
function britishOk(w: string, correct: (x: string) => boolean): boolean {
  const l = w.toLowerCase();
  const us = [
    l.replace(/is(e|ed|es|ing|ation|ations|er|ers)$/, "iz$1"),
    l.replace(/ys(e|ed|es|ing)$/, "yz$1"),
    l.replace(/our(s|ed|ing|ite|ites|able)?$/, "or$1"),
    l.replace(/tre(s)?$/, "ter$1"),
    l.replace(/ogue(s)?$/, "og$1"),
    l.replace(/lled$/, "led").replace(/lling$/, "ling"),
    l.replace(/ence$/, "ense"),
    l === "programme" || l === "programmes" ? l.replace("programme", "program") : l,
  ].filter((x) => x !== l);
  return us.some((x) => correct(x));
}

export const BUZZWORDS = [
  "team player", "hard worker", "hard-working", "hardworking", "results-driven", "results-oriented", "detail-oriented",
  "go-getter", "synergy", "synergies", "think outside the box", "outside the box", "self-starter", "self-motivated",
  "dynamic", "passionate", "best of breed", "go-to person", "proven track record", "track record", "strategic thinker",
  "highly motivated", "excellent communication skills", "fast learner", "quick learner", "rockstar", "rock star",
  "ninja", "guru", "thought leader", "value add", "value-add", "hit the ground running", "people person",
  "seasoned professional", "visionary", "world-class", "cutting-edge", "game changer", "game-changer",
  "references available upon request",
];

export const FILLER = [
  "various", "several", "etc.", "a lot of", "lots of", "very", "really", "basically", "in order to", "successfully",
  "effectively", "efficiently", "numerous", "a variety of", "multiple different", "things", "stuff",
];

const INFORMAL = /\b(stuff|things|awesome|cool|super|gonna|wanna|kinda|lol|btw|tons of|a bunch of)\b|!|[\u{1F300}-\u{1FAFF}]/iu;
const FIRST_PERSON = /\b(I|me|my|mine|myself|we|our)\b/;
const PASSIVE = /\b(was|were|been|being|is|are)\s+(\w+ed|built|led|made|done|given|taken|written|run|sent|held)\b/i;

const STOP = new Set(
  "the a an and or of for to in on at by with from as is are was were be been this that it its our your their we you they i me my us will can may not but if than so into over under about across within per via using use used team teams new data".split(
    " ",
  ),
);

function push(issues: WritingIssue[], issue: WritingIssue) {
  const key = `${issue.kind}|${issue.text.toLowerCase()}`;
  const prev = issues.find((i) => `${i.kind}|${i.text.toLowerCase()}` === key);
  if (prev) prev.count = (prev.count ?? 1) + 1;
  else issues.push({ ...issue, count: 1 });
}

export async function analyzeWriting(
  resume: ParsedResume,
  protectedTerms: string[] = [],
  /** Text rebuilt from page layout (PDF): spacing artifacts there are not the writer's. */
  layoutExtracted = false,
): Promise<WritingReport> {
  const issues: WritingIssue[] = [];
  const lines = resume.lines.filter(Boolean);
  const words = resume.text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const protect = new Set(
    [...protectedTerms, ...BRAND_ALLOWLIST, resume.contact.name ?? "", resume.contact.location ?? "", ...resume.roles.map((r) => r.company)]
      .flatMap((t) => t.split(/[\s,./()&|-]+/))
      .map((w) => w.toLowerCase())
      .filter(Boolean),
  );

  // ---- Spelling ----
  const speller = await getSpeller();
  if (speller) {
    for (const line of lines) {
      if (/@|https?:|www\.|linkedin\.com|github\.com/i.test(line)) continue;
      for (const m of line.matchAll(/(?<![\w.@/-])[A-Za-z][a-z'’]{2,}(?:-[a-z]+)?(?![\w@/.-]*\.\w)/g)) {
        const w = m[0].replace(/[’']s$/, "");
        // Skip proper nouns mid-sentence, acronyms, protected names and words with digits.
        if (/^[A-Z]/.test(w) && m.index! > 0 && !/[.:•]\s*$/.test(line.slice(0, m.index))) continue;
        if (protect.has(w.toLowerCase()) || w.length < 4) continue;
        if (speller.correct(w) || speller.correct(w.toLowerCase())) continue;
        if (w.includes("-") && w.split("-").every((p) => speller.correct(p))) continue;
        if (britishOk(w, (x) => speller.correct(x))) continue;
        push(issues, { kind: "spelling", text: w, message: `Possible misspelling: "${w}"`, suggestions: speller.suggest(w).slice(0, 3), context: line.slice(0, 140) });
      }
    }
  }

  // ---- Grammar & mechanics (rule-based) ----
  const bullets = lines.filter(isBullet).map(stripBullet);
  for (const line of lines) {
    for (const m of line.matchAll(/\b(\w+)\s+\1\b/gi)) {
      if (/^\d+$/.test(m[1]) || m[1].toLowerCase() === "that" || m[1].length < 2) continue;
      push(issues, { kind: "grammar", text: m[0], message: `Repeated word "${m[1]}"`, suggestions: [m[1]], context: line.slice(0, 140) });
    }
    for (const m of line.matchAll(/\b(a)\s+([aeiou]\w+)/gi)) {
      if (/^(uni|use|usu|eu|one|once|ui|ux|us)/i.test(m[2])) continue;
      push(issues, { kind: "grammar", text: m[0], message: `Use "an" before a vowel sound`, suggestions: [`an ${m[2]}`], context: line.slice(0, 140) });
    }
    for (const m of line.matchAll(/\b(an)\s+([bcdfgjklmnpqrstvwxyz]\w+)/gi)) {
      if (/^(hour|honest|honor|heir|mba|msc|ms|mvp|sql|seo|nlp|llm|fpa|rfp|smb|sdk|sla|x)/i.test(m[2])) continue;
      push(issues, { kind: "grammar", text: m[0], message: `Use "a" before a consonant sound`, suggestions: [`a ${m[2]}`], context: line.slice(0, 140) });
    }
    if (/ {2,}\S/.test(line.trim()) && !/ {3,}/.test(line)) {
      push(issues, { kind: "grammar", text: "double space", message: "Double space inside a line", suggestions: [], context: line.slice(0, 140) });
    }
    if (!layoutExtracted && /\s[,.;:](?!\d)/.test(line)) push(issues, { kind: "grammar", text: "space before punctuation", message: "Space before punctuation", suggestions: [], context: line.slice(0, 140) });
  }
  for (const b of bullets) {
    if (/^[a-z]/.test(b)) push(issues, { kind: "grammar", text: b.split(" ")[0], message: "Bullet starts with a lowercase letter", suggestions: [b[0].toUpperCase() + b.split(" ")[0].slice(1)], context: b.slice(0, 140) });
    if (PASSIVE.test(b) && !/^(was|were)\s+(promoted|selected|awarded|recognized|named|invited|chosen)/i.test(b))
      push(issues, { kind: "grammar", text: b.match(PASSIVE)![0], message: "Passive voice weakens ownership; lead with what you did", suggestions: [], context: b.slice(0, 140) });
  }
  // Consistent end punctuation across bullets.
  if (bullets.length >= 4) {
    const withPeriod = bullets.filter((b) => /\.$/.test(b)).length;
    if (withPeriod > 0 && withPeriod < bullets.length && Math.min(withPeriod, bullets.length - withPeriod) >= 2)
      push(issues, { kind: "grammar", text: "inconsistent periods", message: `${withPeriod} of ${bullets.length} bullets end with a period; pick one style`, suggestions: [], context: "" });
  }
  // Tense: present-tense openers in past roles.
  for (const r of resume.roles) {
    const isPast = r.dates && r.dates.end !== "present";
    if (!isPast) continue;
    for (const b of r.bullets) {
      const fw = firstWord(b);
      if (/^(manage|lead|build|develop|create|design|drive|own|oversee|run|handle|support|implement|analyze|coordinate)s?$/.test(fw))
        push(issues, { kind: "grammar", text: b.split(" ")[0], message: "Present tense in a past role; use past tense", suggestions: [], context: b.slice(0, 140) });
    }
  }

  // ---- Repetition ----
  const openers = new Map<string, number>();
  for (const b of bullets) {
    const fw = firstWord(b);
    if (fw) openers.set(fw, (openers.get(fw) ?? 0) + 1);
  }
  openers.forEach((n, w) => {
    if (n >= 3) push(issues, { kind: "repetition", text: w, message: `${n} bullets open with "${w}"; vary your action verbs`, suggestions: [], context: "", count: n });
  });
  const bodyText = bullets.join(" ").toLowerCase();
  const freq = new Map<string, number>();
  for (const w of bodyText.match(/[a-z][a-z'-]{3,}/g) ?? []) if (!STOP.has(w) && !protect.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const topRepeated = [...freq.entries()].filter(([, n]) => n >= Math.max(4, bullets.length / 3)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [w, n] of topRepeated) push(issues, { kind: "repetition", text: w, message: `"${w}" is used ${n} times in your bullets`, suggestions: [], context: "", count: n });
  // Repeated 3-word phrases.
  const tri = new Map<string, number>();
  const toks = bodyText.match(/[a-z0-9'-]+/g) ?? [];
  for (let i = 0; i + 2 < toks.length; i++) {
    const g = toks.slice(i, i + 3);
    if (g.every((t) => STOP.has(t))) continue;
    const k = g.join(" ");
    tri.set(k, (tri.get(k) ?? 0) + 1);
  }
  [...tri.entries()].filter(([k, n]) => n >= 3 && k.split(" ").filter((t) => !STOP.has(t)).length >= 2).slice(0, 3).forEach(([k, n]) =>
    push(issues, { kind: "repetition", text: k, message: `Phrase "${k}" appears ${n} times`, suggestions: [], context: "", count: n }),
  );

  // ---- Buzzwords & filler ----
  const lower = resume.text.toLowerCase();
  for (const b of BUZZWORDS) {
    const re = new RegExp(`(?<![a-z])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "g");
    const n = (lower.match(re) ?? []).length;
    if (n) push(issues, { kind: "buzzword", text: b, message: `Cliché "${b}": show it with evidence instead of claiming it`, suggestions: [], context: lines.find((l) => l.toLowerCase().includes(b))?.slice(0, 140) ?? "", count: n });
  }
  for (const f of FILLER) {
    const re = new RegExp(`(?<![a-z])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "g");
    const n = (bodyText.match(re) ?? []).length;
    if (n) push(issues, { kind: "filler", text: f, message: `Filler "${f}" adds words without meaning`, suggestions: f === "in order to" ? ["to"] : [], context: bullets.find((b) => b.toLowerCase().includes(f))?.slice(0, 140) ?? "", count: n });
  }

  // ---- Tone ----
  const fp = bullets.filter((b) => FIRST_PERSON.test(b)).length + (FIRST_PERSON.test(resume.summary) ? 1 : 0);
  const informal = lines.filter((l) => INFORMAL.test(l)).length;
  if (fp) push(issues, { kind: "tone", text: "first person", message: `First-person pronouns (I, my, we) in ${fp} line(s); resumes use implied first person`, suggestions: [], context: [...bullets, resume.summary].find((b) => FIRST_PERSON.test(b))?.slice(0, 140) ?? "", count: fp });
  if (informal) push(issues, { kind: "tone", text: "informal language", message: `Informal words, exclamation marks or emoji in ${informal} line(s)`, suggestions: [], context: lines.find((l) => INFORMAL.test(l))?.slice(0, 140) ?? "", count: informal });
  const tone: WritingReport["tone"] = informal >= 2 || (fp >= 3 && informal) ? "informal" : fp || informal ? "mixed" : "professional";

  // ---- Score ----
  const counts = { spelling: 0, grammar: 0, repetition: 0, buzzword: 0, filler: 0, tone: 0 } as Record<WritingIssueKind, number>;
  for (const i of issues) counts[i.kind] += i.kind === "spelling" || i.kind === "grammar" ? (i.count ?? 1) : 1;
  const score = Math.max(
    0,
    Math.round(
      100 -
        Math.min(30, counts.spelling * 4) -
        Math.min(20, counts.grammar * 3) -
        Math.min(15, counts.repetition * 3) -
        Math.min(15, counts.buzzword * 3) -
        Math.min(10, counts.filler * 2) -
        (tone === "informal" ? 10 : tone === "mixed" ? 5 : 0),
    ),
  );
  const order: WritingIssueKind[] = ["spelling", "grammar", "tone", "buzzword", "repetition", "filler"];
  issues.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return { score, tone, issues, counts, wordCount: words.length };
}
