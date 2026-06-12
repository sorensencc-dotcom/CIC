import { TextSegment, PipelineStage } from "../interfaces/postprocessor";

export class AuditorStage implements PipelineStage {
  name = "Auditor";

  async execute(segments: TextSegment[]): Promise<TextSegment[]> {
    // Placeholder: auditor stage (no-op for Phase 2)
    return segments;
  }
}
