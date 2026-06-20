import { TextSegment, PostProcessorConfig, PipelineStage, Pipeline } from "../interfaces/postprocessor";

export interface PipelineConfig {
  harvester?: Record<string, unknown>;
  postProcessor?: PostProcessorConfig;
  auditor?: Record<string, unknown>;
  synthesizer?: Record<string, unknown>;
}

export interface StageFactory {
  name: string;
  create(config?: Record<string, unknown>): PipelineStage;
}

export class DefaultPipeline implements Pipeline {
  private stages: Map<string, PipelineStage>;

  constructor(stages?: Map<string, PipelineStage>) {
    this.stages = stages || new Map();
  }

  async execute(segments: TextSegment[]): Promise<TextSegment[]> {
    let currentSegments = segments;

    for (const stage of this.stages.values()) {
      currentSegments = await stage.execute(currentSegments);
    }

    return currentSegments;
  }

  getStages(): PipelineStage[] {
    return Array.from(this.stages.values());
  }

  addStage(stage: PipelineStage): void {
    this.stages.set(stage.name, stage);
  }
}
