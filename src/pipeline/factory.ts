import { TextSegment, PipelineStage, PostProcessor, PostProcessorConfig, Pipeline } from "../interfaces/postprocessor";
import { DefaultPipeline, PipelineConfig } from "./types";

export class PipelineFactory {
  static createPipeline(config: PipelineConfig, stages?: Map<string, PipelineStage>): Pipeline {
    const pipeline = new DefaultPipeline(stages);
    return pipeline;
  }

  static wrapPostProcessor(postProcessor: PostProcessor): PipelineStage {
    return {
      name: "PostProcessor",
      async execute(segments: TextSegment[]): Promise<TextSegment[]> {
        // Process all segments in batch
        const results = postProcessor.processBatch(segments);

        // Update segments with humanization results
        segments.forEach((segment, idx) => {
          // Only set humanized if processing actually happened
          if (results[idx].applied || results[idx].edits.length > 0) {
            segment.humanized = results[idx];
          }
          // Apply final content if not dry-run
          if (results[idx].finalContent !== segment.content) {
            segment.content = results[idx].finalContent;
          }
        });

        return segments;
      },
    };
  }
}

export { DefaultPipeline, PipelineConfig };
