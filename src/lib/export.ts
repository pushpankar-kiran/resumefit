import { classifyHeading } from "./nlp/resume";
import { isBullet, stripBullet } from "./nlp/text";

/** Plain, single-column Markdown: name as H1, recognized headings as H2, bullets as "-". */
export function toMarkdown(text: string): string {
  const lines = text.split("\n");
  let nameDone = false;
  return lines
    .map((raw) => {
      const l = raw.trim();
      if (!l) return "";
      if (!nameDone) {
        nameDone = true;
        return `# ${l}`;
      }
      if (classifyHeading(l)) return `\n## ${l.replace(/:$/, "").replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase())}`;
      if (isBullet(l)) return `- ${stripBullet(l)}`;
      return l;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
