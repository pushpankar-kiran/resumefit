// One-off: seed aliases.json "related" groups from the taxonomy's TOOL families. Concept and
// soft-skill families are excluded on purpose (sharing a word like "management" isn't a sibling).
import { readFileSync, writeFileSync } from "node:fs";
import { SKILLS } from "../src/lib/nlp/skills";

const EXCLUDE = new Set(["pm", "pjm", "biz", "finance", "marketing", "ops", "practice", "research", "metrics", "analytics", "design", "security", "agile", "think", "comm", "drive", "lead", "cust", "collab"]);
const groups = new Map<string, string[]>();
for (const s of SKILLS) {
  if (!s.family || EXCLUDE.has(s.family) || s.category === "soft_skill") continue;
  groups.set(s.family, [...(groups.get(s.family) ?? []), s.term, ...s.aliases]);
}
const related: Record<string, string[]> = {};
for (const [fam, members] of groups) {
  const uniq = [...new Set(members.map((m) => m.toLowerCase()))];
  if (uniq.length >= 2) related[fam] = uniq;
}
const path = "src/lib/nlp/aliases.json";
const file = JSON.parse(readFileSync(path, "utf8"));
file.related = related;
writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
console.log(Object.keys(related).length, "groups:", Object.keys(related).join(", "));
