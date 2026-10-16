import type { ContactField, ContactPresence, ParsedDocument, ParsedResume } from "../types";
import { EMAIL_RE, LINKEDIN_RE, findPhone } from "./resume";

// Where each contact detail was found, so "absent" and "could not read" are reported
// differently. Every place is searched: body, tables, text boxes, headers, footers and
// hyperlink targets (mailto:, tel:, linkedin.com in the .rels files).

type Doc = Pick<ParsedDocument, "text" | "naiveText" | "links" | "layout">;

const FIND: Record<ContactField, (text: string) => string | null> = {
  email: (t) => t.match(EMAIL_RE)?.[0] ?? null,
  phone: (t) => findPhone(t),
  linkedin: (t) => t.match(LINKEDIN_RE)?.[0] ?? null,
};
const LINK: Record<ContactField, (l: string) => string | null> = {
  email: (l) => l.match(/^mailto:([^?]+)/i)?.[1] ?? null,
  phone: (l) => l.match(/^tel:(.+)/i)?.[1] ?? null,
  linkedin: (l) => (LINKEDIN_RE.test(l) ? l : null),
};
// Signs the detail is there but in a form we can't read: a label with no value, an "@" that
// isn't a valid address, link text such as "Email" pointing somewhere unparseable.
const CLUE: Record<ContactField, RegExp> = {
  email: /\b(e-?mail|mail)\s*[:|]|\S+\s?(@|\(at\)|\[at\])\s?\S+/i,
  phone: /\b(phone|mobile|mob|tel|cell|contact no)\b\.?\s*[:|]/i,
  linkedin: /\blinked\s?in\b/i,
};

export function contactPresence(doc: Doc, resume: ParsedResume): ContactPresence[] {
  const hf = doc.layout.headerFooterText ?? "";
  const body = doc.naiveText ?? "";
  return (["email", "phone", "linkedin"] as ContactField[]).map((field) => {
    const value = resume.contact[field];
    if (value) {
      const where: ContactPresence["where"] = FIND[field](body)
        ? "body"
        : hf && FIND[field](hf)
          ? "header/footer"
          : FIND[field](doc.text)
            ? "table or text box"
            : doc.links.some((l) => LINK[field](l))
              ? "link target"
              : "body";
      return { field, state: where === "body" ? "found" : "hard to read", where, value };
    }
    const clue = doc.text.match(CLUE[field])?.[0]?.trim() ?? null;
    return clue ? { field, state: "could not read", where: null, value: null, clue } : { field, state: "absent", where: null, value: null };
  });
}

export const PLACES_SEARCHED = "body, tables, text boxes, header, footer and hyperlink targets";
