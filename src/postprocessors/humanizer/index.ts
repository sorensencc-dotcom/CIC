import {
  PostProcessor,
  PostProcessorConfig,
  TextSegment,
  HumanizationResult,
  EditRecord,
} from "../../interfaces/postprocessor";
import { getActiveRules } from "../humanizer-rules/index";

export class HumanizerPostProcessor implements PostProcessor {
  private config: PostProcessorConfig;

  constructor(config: PostProcessorConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.config.enabled) {
      // Run determinism check on startup
      const isDeterministic = this.isDeterministic(10);
      if (!isDeterministic) {
        console.warn("[Humanizer] Warning: Non-deterministic behavior detected");
      }
    }
  }

  process(segment: TextSegment): HumanizationResult {
    if (!this.config.enabled) {
      // Don't populate segment.humanized when disabled
      return {
        applied: false,
        finalContent: segment.content,
        edits: [],
        metadata: {},
      };
    }

    const rules = getActiveRules(this.config.profile || "default", this.config.ruleTiers);
    let content = segment.content;
    const allEdits: EditRecord[] = [];

    // Apply each rule in sequence
    for (const rule of rules) {
      const result = rule.apply(content);
      content = result.text;
      allEdits.push(...result.edits);
    }

    // Filter edits by confidence threshold
    const applyThreshold = this.config.confidenceThresholds?.apply ?? 0.7;
    const filteredEdits = allEdits.filter((edit) => edit.confidence >= applyThreshold);

    // Apply edits to content (unless dry-run)
    let finalContent = segment.content;
    if (!this.config.dryRun) {
      finalContent = content;
    }

    const result: HumanizationResult = {
      applied: filteredEdits.length > 0,
      finalContent,
      edits: filteredEdits,
      metadata: {
        profile: this.config.profile,
        rulesApplied: filteredEdits.length,
        totalRules: rules.length,
      },
    };

    // Populate segment with result
    segment.humanized = result;

    return result;
  }

  processBatch(segments: TextSegment[]): HumanizationResult[] {
    return segments.map((segment) => this.process(segment));
  }

  getRulesApplied(segment: TextSegment): EditRecord[] {
    return segment.humanized?.edits || [];
  }

  isDeterministic(iterations: number = 10): boolean {
    const testSegment: TextSegment = {
      id: "determinism-test",
      source: "test",
      content:
        "The approach—primary promoted by institutions. Additionally, this enduring testament highlights importance.",
    };

    const results: string[] = [];

    for (let i = 0; i < iterations; i++) {
      const result = this.process({
        id: testSegment.id,
        source: testSegment.source,
        content: testSegment.content,
      });
      results.push(result.finalContent);
    }

    // Check if all results are identical
    const first = results[0];
    const isDeterministic = results.every((result) => result === first);

    return isDeterministic;
  }

  cleanup(): void {
    // Placeholder for resource cleanup
  }
}
