import { TextSegment, PipelineStage } from "../interfaces/postprocessor";

export class HarvesterStage implements PipelineStage {
  name = "Harvester";

  async execute(segments: TextSegment[]): Promise<TextSegment[]> {
    // Placeholder: harvester stage (no-op for Phase 2)
    return segments;
  }
}
