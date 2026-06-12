import { HumanizerRule, EditRecord } from "../../interfaces/postprocessor";

export const rule14_EmDashes: HumanizerRule = {
  id: 14,
  name: "Em-dash to comma",
  tier: 1,
  category: "language",
  description: "Convert em-dashes and en-dashes to commas (mechanical replacement)",
  signalWords: ["em-dash", "en-dash", "dash"],
  apply(text: string) {
    if (!text) return { text: text || "", edits: [] };

    const edits: EditRecord[] = [];

    const emDash = String.fromCharCode(0x2014); // —
    const enDash = String.fromCharCode(0x2013); // –

    const patterns: Array<[RegExp, string]> = [
      [new RegExp(emDash, "g"), ", "],
      [new RegExp(enDash, "g"), ", "],
      [/ -- /g, ", "],
    ];

    let result = text;

    for (const [pattern, replacement] of patterns) {
      let match;
      const regex = new RegExp(pattern);
      while ((match = regex.exec(text)) !== null) {
        const lineNum = text.substring(0, match.index).split("\n").length;
        edits.push({
          ruleId: 14,
          ruleName: "Em-dash to comma",
          category: "language",
          tier: 1,
          before: match[0],
          after: replacement,
          confidence: 1.0,
          lineNum,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
        });
      }
      if (result) result = result.replace(pattern, replacement);
    }

    return { text: result, edits };
  },
};

export const rule19_CurlyQuotes: HumanizerRule = {
  id: 19,
  name: "Curly quotes normalization",
  tier: 1,
  category: "language",
  description: "Convert curly quotes to straight quotes",
  signalWords: ["curly", "smart", "quotes"],
  apply(text: string) {
    const edits: EditRecord[] = [];
    const leftCurlyDbl = String.fromCharCode(0x201c);
    const rightCurlyDbl = String.fromCharCode(0x201d);
    const leftCurlySgl = String.fromCharCode(0x2018);
    const rightCurlySgl = String.fromCharCode(0x2019);

    let result = text;

    // Find and replace double curly quotes
    if (text.includes(leftCurlyDbl) || text.includes(rightCurlyDbl)) {
      const matches = [...text.matchAll(new RegExp(`[${leftCurlyDbl}${rightCurlyDbl}]`, "g"))];
      matches.forEach((match) => {
        const lineNum = text.substring(0, match.index).split("\n").length;
        edits.push({
          ruleId: 19,
          ruleName: "Curly quotes normalization",
          category: "language",
          tier: 1,
          before: match[0],
          after: '"',
          confidence: 1.0,
          lineNum,
          startOffset: match.index!,
          endOffset: match.index! + 1,
        });
      });
      result = result.replace(new RegExp(`[${leftCurlyDbl}${rightCurlyDbl}]`, "g"), '"');
    }

    // Find and replace single curly quotes
    if (text.includes(leftCurlySgl) || text.includes(rightCurlySgl)) {
      const matches = [...text.matchAll(new RegExp(`[${leftCurlySgl}${rightCurlySgl}]`, "g"))];
      matches.forEach((match) => {
        const lineNum = result.substring(0, match.index).split("\n").length;
        edits.push({
          ruleId: 19,
          ruleName: "Curly quotes normalization",
          category: "language",
          tier: 1,
          before: match[0],
          after: "'",
          confidence: 1.0,
          lineNum,
          startOffset: match.index!,
          endOffset: match.index! + 1,
        });
      });
      result = result.replace(new RegExp(`[${leftCurlySgl}${rightCurlySgl}]`, "g"), "'");
    }

    return { text: result, edits };
  },
};

export const rule17_TitleCase: HumanizerRule = {
  id: 17,
  name: "Title case to sentence case",
  tier: 1,
  category: "style",
  description: "Convert all-caps initial word to sentence case at line start",
  signalWords: ["CAPS", "Title", "Case"],
  apply(text: string) {
    const edits: EditRecord[] = [];
    let result = text;

    const lines = text.split("\n");
    const processedLines = lines.map((line, lineNum) => {
      const match = line.match(/^([A-Z]{2,})\s/);
      if (match) {
        const original = match[1];
        const converted = original.charAt(0) + original.slice(1).toLowerCase();
        edits.push({
          ruleId: 17,
          ruleName: "Title case to sentence case",
          category: "style",
          tier: 1,
          before: original,
          after: converted,
          confidence: 1.0,
          lineNum: lineNum + 1,
          startOffset: 0,
          endOffset: original.length,
        });
        return line.replace(original, converted);
      }
      return line;
    });

    result = processedLines.join("\n");
    return { text: result, edits };
  },
};

export const rule18_Emojis: HumanizerRule = {
  id: 18,
  name: "Remove emoji decorations",
  tier: 1,
  category: "style",
  description: "Remove emoji decorations from headings and list items",
  signalWords: ["emoji", "decoration", "bullet"],
  apply(text: string) {
    const edits: EditRecord[] = [];

    const lines = text.split("\n");
    const processedLines = lines.map((line, lineNum) => {
      // Match lines starting with emoji-like symbols (includes \p{Emoji}, checkmarks, etc)
      // Matches emoji or special symbols followed by space
      const emojiMatch = line.match(/^[\p{Emoji}\p{So}]+\s+/u);
      if (emojiMatch) {
        const matched = emojiMatch[0];
        edits.push({
          ruleId: 18,
          ruleName: "Remove emoji decorations",
          category: "style",
          tier: 1,
          before: matched.trimEnd(),
          after: "",
          confidence: 1.0,
          lineNum: lineNum + 1,
          startOffset: 0,
          endOffset: matched.length,
        });
        return line.replace(emojiMatch[0], "");
      }
      return line;
    });

    const result = processedLines.join("\n");
    return { text: result, edits };
  },
};

export const rule15_Boldface: HumanizerRule = {
  id: 15,
  name: "Remove unnecessary boldface",
  tier: 1,
  category: "style",
  description: "Remove bold formatting from short phrases and acronyms (≤3 words)",
  signalWords: ["**", "bold"],
  apply(text: string) {
    const edits: EditRecord[] = [];
    let result = text;

    const boldPattern = /\*\*([^*]+)\*\*/g;
    let match;

    while ((match = boldPattern.exec(text)) !== null) {
      const content = match[1];
      const wordCount = content.trim().split(/\s+/).length;

      // Remove boldface from short phrases (≤3 words) or acronyms
      if (wordCount <= 3 || /^[A-Z]{2,}$/.test(content.trim())) {
        const lineNum = text.substring(0, match.index).split("\n").length;
        edits.push({
          ruleId: 15,
          ruleName: "Remove unnecessary boldface",
          category: "style",
          tier: 1,
          before: match[0],
          after: content,
          confidence: 0.95,
          lineNum,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
        });
        result = result.replace(match[0], content);
      }
    }

    return { text: result, edits };
  },
};

export const TIER1_RULES: HumanizerRule[] = [
  rule14_EmDashes,
  rule19_CurlyQuotes,
  rule17_TitleCase,
  rule18_Emojis,
  rule15_Boldface,
];
