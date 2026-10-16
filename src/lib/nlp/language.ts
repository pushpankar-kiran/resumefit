// Lightweight language identification: script detection first, then stop-word votes for
// Latin-script languages. Good enough to warn that keyword matching is English-only.

const STOPWORDS: Record<string, string[]> = {
  English: ["the", "and", "with", "for", "you", "our", "will", "experience", "to", "of", "in", "a", "is", "are", "we", "your"],
  Spanish: ["el", "la", "los", "las", "y", "con", "para", "experiencia", "de", "en", "que", "una", "por", "nuestro"],
  French: ["le", "la", "les", "et", "avec", "pour", "expérience", "de", "des", "en", "une", "nous", "vous", "du"],
  German: ["der", "die", "das", "und", "mit", "für", "erfahrung", "sie", "wir", "ein", "eine", "zu", "von", "im"],
  Portuguese: ["o", "os", "as", "e", "com", "para", "experiência", "de", "em", "uma", "você", "nosso", "na", "no"],
  Dutch: ["de", "het", "en", "met", "voor", "ervaring", "je", "wij", "een", "van", "in", "op", "jij"],
  Italian: ["il", "lo", "gli", "e", "con", "per", "esperienza", "di", "in", "una", "noi", "che", "della"],
};

export function detectLanguage(text: string): { language: string; confidence: number } {
  const sample = text.slice(0, 6000);
  const letters = sample.replace(/[^\p{L}]/gu, "");
  if (!letters.length) return { language: "Unknown", confidence: 0 };
  const scripts: [string, RegExp][] = [
    ["Chinese/Japanese", /[぀-ヿ一-鿿]/gu],
    ["Korean", /[가-힯]/gu],
    ["Russian/Cyrillic", /[Ѐ-ӿ]/gu],
    ["Arabic", /[؀-ۿ]/gu],
    ["Hindi/Devanagari", /[ऀ-ॿ]/gu],
    ["Hebrew", /[֐-׿]/gu],
    ["Greek", /[Ͱ-Ͽ]/gu],
    ["Thai", /[฀-๿]/gu],
  ];
  for (const [name, re] of scripts) {
    const n = sample.match(re)?.length ?? 0;
    if (n / letters.length > 0.3) return { language: name, confidence: n / letters.length };
  }
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 15) return { language: "English", confidence: 0.4 };
  const scores = Object.entries(STOPWORDS).map(([lang, list]) => {
    const set = new Set(list);
    return [lang, words.filter((w) => set.has(w)).length / words.length] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [lang, score] = scores[0];
  return { language: score < 0.03 ? "Unknown" : lang, confidence: score };
}
