import { UserContext, TraversalResult } from "../torquequery-sdk/fs";
import { fsClient } from "./torquequeryFSClient";
import { FSTraversalPolicy } from "./fsTraversalPolicy";

export interface BuildFailure {
  step: string;          // "compile", "test", "deploy", "lint", etc.
  message: string;       // raw error message
  file?: string;         // optional file/module
  symbol?: string;       // missing symbol, function, class, etc.
  endpoint?: string;     // failing API route
  configKey?: string;    // failing env/config key
}

export interface BuildReport {
  summary: string;
  rootCause: string;
  fix: string;
  sources: string[];
  strategy: string;
}

export function buildFailureQuery(f: BuildFailure): string {
  const parts: string[] = [];

  parts.push(`Build step: ${f.step}`);
  parts.push(`Error: ${f.message}`);

  if (f.file) parts.push(`File: ${f.file}`);
  if (f.symbol) parts.push(`Symbol: ${f.symbol}`);
  if (f.endpoint) parts.push(`Endpoint: ${f.endpoint}`);
  if (f.configKey) parts.push(`Config key: ${f.configKey}`);

  // Extract high‑signal tokens from the message
  const tokens = extractFailureTokens(f.message);
  if (tokens.length) {
    parts.push(`Tokens: ${tokens.join(", ")}`);
  }

  return parts.join(" | ");
}

function extractFailureTokens(msg: string): string[] {
  const regex = /[A-Za-z0-9_\-\/\.]+/g;
  const raw = msg.match(regex) || [];
  return raw
    .filter(t => t.length > 3)
    .slice(0, 5); // cap to avoid noise
}

export function synthesizeBuildReport(
  failure: BuildFailure,
  fsResult: TraversalResult
): BuildReport {
  const summary = `The build failed during the "${failure.step}" step with the error: ${failure.message}`;

  const rootCause = fsResult.answer
    ? `Relevant documentation was found using ${fsResult.strategy}. Based on the retrieved content, the likely root cause is:\n\n${summarize(fsResult.answer)}`
    : `No relevant documentation was found. The failure may be due to a missing configuration, incorrect endpoint usage, or an undocumented behavior.`;

  const fix = suggestFix(failure, fsResult);

  return {
    summary,
    rootCause,
    fix,
    sources: fsResult.sources,
    strategy: fsResult.strategy
  };
}

function summarize(text: string): string {
  // Simple heuristic: take first 3–5 sentences
  const sentences = text.split(/[\.\n]/).filter(Boolean);
  return sentences.slice(0, 5).join(". ") + ".";
}

function suggestFix(failure: BuildFailure, fsResult: TraversalResult): string {
  // Config error
  if (failure.configKey) {
    return `Check the configuration key "${failure.configKey}". Ensure it is defined, spelled correctly, and matches the documented format.`;
  }

  // API error
  if (failure.endpoint) {
    return `Verify that the endpoint "${failure.endpoint}" is used correctly. Compare your request with the documented method, parameters, and schema.`;
  }

  // Symbol error
  if (failure.symbol) {
    return `The symbol "${failure.symbol}" appears to be missing or mis‑referenced. Confirm it exists and is imported correctly.`;
  }

  // Fallback
  return `Review the referenced documentation and adjust your code or configuration accordingly.`;
}

export class CICBuildAgent {
  private policy: FSTraversalPolicy;

  constructor() {
    this.policy = new FSTraversalPolicy(fsClient, fsClient, fsClient);
  }

  /**
   * Process a build failure context, query the Virtual FS for relevant docs,
   * and synthesize a structured build diagnosis report.
   */
  async handleBuildFailure(user: UserContext, failure: BuildFailure): Promise<BuildReport> {
    const query = buildFailureQuery(failure);
    const fsResult = await this.policy.answer(user, query);
    return synthesizeBuildReport(failure, fsResult);
  }
}
