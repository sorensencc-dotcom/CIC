export interface EditRecord {
  ruleId: number;
  ruleName: string;
  category: string;
  tier?: number;
  before: string;
  after: string;
  confidence: number;
  lineNum: number;
  startOffset: number;
  endOffset: number;
  reason?: string;
}

export interface HumanizationResult {
  applied: boolean;
  finalContent: string;
  edits: EditRecord[];
  metadata?: Record<string, unknown>;
}

export interface TextSegment {
  id: string;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  humanized?: HumanizationResult;
}

export interface PostProcessorConfig {
  enabled: boolean;
  profile?: "default" | "rewrite-labs" | "custom";
  ruleTiers?: Record<string, boolean>;
  voiceCalibration?: {
    preserve?: string[];
    amplify?: string[];
  };
  dryRun?: boolean;
  confidenceThresholds?: {
    apply?: number;
    report?: number;
  };
}

export interface HumanizerRule {
  id: number;
  name: string;
  tier: number;
  category: string;
  description: string;
  signalWords?: string[];
  apply(text: string): { text: string; edits: EditRecord[] };
  isEnabled?(): boolean;
}

export interface PostProcessor {
  process(segment: TextSegment): HumanizationResult;
  processBatch(segments: TextSegment[]): HumanizationResult[];
  getRulesApplied(segment: TextSegment): EditRecord[];
  isDeterministic(iterations?: number): boolean;
  initialize?(): Promise<void>;
  cleanup?(): void;
}

export interface PipelineStage {
  name: string;
  execute(segments: TextSegment[]): Promise<TextSegment[]>;
}

export interface Pipeline {
  execute(segments: TextSegment[]): Promise<TextSegment[]>;
  getStages(): PipelineStage[];
  addStage(stage: PipelineStage): void;
}

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
