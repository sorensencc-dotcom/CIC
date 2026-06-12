import { HumanizerRule, EditRecord } from "../../interfaces/postprocessor";

export const rule23_FillerPhrases: HumanizerRule = {
  id: 23,
  name: "Remove filler phrases",
  tier: 2,
  category: "filler",
  description: "Replace redundant filler phrases with concise alternatives",
  signalWords: ["In order to", "Due to the fact that", "In the event that"],
  apply(text: string) {
    const edits: EditRecord[] = [];
    let result = text;

    const fillerMap: Array<[RegExp, string]> = [
      [/in order to/gi, "To"],
      [/due to the fact that/gi, "Because"],
      [/in the event that/gi, "If"],
      [/it is important to note that/gi, "Note that"],
      [/a large number of/gi, "many"],
    ];

    fillerMap.forEach(([pattern, replacement]) => {
      const regex = new RegExp(pattern);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const lineNum = text.substring(0, match.index).split("\n").length;
        edits.push({
          ruleId: 23,
          ruleName: "Remove filler phrases",
          category: "filler",
          tier: 2,
          before: match[0],
          after: replacement,
          confidence: 0.92,
          lineNum,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
        });
      }
      result = result.replace(pattern, replacement);
    });

    return { text: result, edits };
  },
};

export const rule26_HyphenatedPairs: HumanizerRule = {
  id: 26,
  name: "Remove hyphens in predicate adjectives",
  tier: 2,
  category: "language",
  description: "Remove hyphens from predicate adjectives (e.g., 'is high-quality' → 'is high quality')",
  signalWords: ["is", "was", "are", "-"],
  apply(text: string) {
    const edits: EditRecord[] = [];
    let result = text;

    const predicatePattern = /is\s+([a-z]+-[a-z]+)/gi;
    let match;

    while ((match = predicatePattern.exec(text)) !== null) {
      const hyphenated = match[1];
      const unhyphenated = hyphenated.replace(/-/g, " ");

      const lineNum = text.substring(0, match.index).split("\n").length;
      edits.push({
        ruleId: 26,
        ruleName: "Remove hyphens in predicate adjectives",
        category: "language",
        tier: 2,
        before: hyphenated,
        after: unhyphenated,
        confidence: 0.88,
        lineNum,
        startOffset: match.index + 3,
        endOffset: match.index + 3 + hyphenated.length,
      });

      result = result.replace(hyphenated, unhyphenated);
    }

    return { text: result, edits };
  },
};

export const rule8_CopulaAvoidance: HumanizerRule = {
  id: 8,
  name: "Replace verbose copulas",
  tier: 2,
  category: "language",
  description: "Replace verbose copula phrases with simpler verbs",
  signalWords: ["serves as", "stands as", "boasts", "features", "offers"],
  apply(text: string) {
    const edits: EditRecord[] = [];
    let result = text;

    const copulaMap: Array<[RegExp, string]> = [
      [/serves as/gi, "is"],
      [/stands as/gi, "is"],
      [/boasts/gi, "has"],
      [/features/gi, "has"],
      [/\boffer(s?)\b/gi, "provide$1"],
    ];

    copulaMap.forEach(([pattern, replacement]) => {
      const regex = new RegExp(pattern);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const lineNum = text.substring(0, match.index).split("\n").length;
        edits.push({
          ruleId: 8,
          ruleName: "Replace verbose copulas",
          category: "language",
          tier: 2,
          before: match[0],
          after: replacement,
          confidence: 0.9,
          lineNum,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
        });
      }
      result = result.replace(pattern, replacement);
    });

    return { text: result, edits };
  },
};

export const rule7_AIVocabulary: HumanizerRule = {
  id: 7,
  name: "Flag overused AI vocabulary",
  tier: 2,
  category: "content",
  description: "Detect and flag overused AI writing patterns",
  signalWords: ["Additionally", "enduring", "enhance", "emphasizing"],
  apply(text: string) {
    const edits: EditRecord[] = [];

    const aiWords: Record<string, { replacement: string; confidence: number }> = {
      Additionally: { replacement: "Also", confidence: 0.85 },
      enduring: { replacement: "lasting", confidence: 0.82 },
      enhance: { replacement: "improve", confidence: 0.88 },
      emphasizing: { replacement: "stressing", confidence: 0.80 },
      groundbreaking: { replacement: "novel", confidence: 0.85 },
      pivotal: { replacement: "key", confidence: 0.83 },
      testament: { replacement: "evidence", confidence: 0.80 },
    };

    Object.entries(aiWords).forEach(([word, { replacement, confidence }]) => {
      const pattern = new RegExp(`\\b${word}\\b`, "gi");
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const lineNum = text.substring(0, match.index).split("\n").length;
        edits.push({
          ruleId: 7,
          ruleName: "Flag overused AI vocabulary",
          category: "content",
          tier: 2,
          before: match[0],
          after: replacement,
          confidence,
          lineNum,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
        });
      }
    });

    // Apply only high-confidence replacements
    let result = text;
    edits.forEach((edit) => {
      result = result.replace(new RegExp(`\\b${edit.before}\\b`, "g"), edit.after);
    });

    return { text: result, edits };
  },
};

export const TIER2_RULES: HumanizerRule[] = [
  rule23_FillerPhrases,
  rule26_HyphenatedPairs,
  rule8_CopulaAvoidance,
  rule7_AIVocabulary,
];
