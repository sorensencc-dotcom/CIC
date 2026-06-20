// Phase 0.7 build system types

export interface BuildGraphNode {
  id: string;
  type: 'source' | 'container';
  dockerfile: string | null;
  runtime: 'none' | 'cpu' | 'gpu';
  depends_on: string[];
  capabilities: string[];
  policies: string[];
  parallelJobs?: number;
  memoryLimit?: string;
  clearLocks?: boolean;
  killOrphanedProcesses?: boolean;
  usePinnedDependencies?: boolean;
  useCache?: boolean;
  cleanBuild?: boolean;
  resetEnv?: boolean;
  simulateFailure?: {
    errorType: 'oom' | 'gpuOom' | 'lockContention' | 'dependencyConflict' | 'execTimeExceeded' | 'driftSignature' | 'generic';
    errorMessage: string;
    attemptsToFail?: number;
  };
}

export interface BuildGraphSink {
  id: string;
  type: 'registry' | 'telemetry';
  accepts: string[];
}

export interface BuildGraph {
  version: string;
  generated_at: string;
  description: string;
  nodes: BuildGraphNode[];
  sinks: BuildGraphSink[];
}

export interface BuildProvenance {
  git_sha: string;
  timestamp: string;
  sbom_ref: string;
  author?: string;
  message?: string;
}

export interface ArtifactRecord {
  artifact_id: string;
  agent_id: string;
  version: string;
  build_id: string;
  inputs: string[];
  outputs: string[];
  provenance: BuildProvenance;
  drift_signature: string;
  parent_build_id: string | null;
  created_at: string;
  completed_at?: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
}

export interface RouteRequest {
  phase: string;
  from: string;
  to: string;
  channel: string;
}

export interface DriftIssue {
  build_id: string;
  issue_type: 'signature_mismatch' | 'input_divergence' | 'output_divergence' | 'provenance_invalid';
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  detected_at: string;
}

export interface NodeExecutionContext {
  node_id: string;
  build_id: string;
  phase: string;
  inputs: Map<string, string>;
  outputs: Map<string, string>;
  start_time: Date;
  end_time?: Date;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  error?: Error;
}

export interface BuildExecutionPlan {
  build_id: string;
  phase: string;
  nodes: string[];
  execution_order: string[][];
  created_at: string;
}

// ============================================================================
// Phase 0.9 Self-Healing Build System Types
// ============================================================================

export type SymptomType =
  | 'execTimeExceeded'
  | 'noOutput'
  | 'noHeartbeat'
  | 'oom'
  | 'gpuOom'
  | 'dependencyConflict'
  | 'lockContention'
  | 'driftSignature';

export type FailureCategory = 'timeout' | 'crash' | 'drift' | 'resource' | 'cascade';

export interface FailureClassification {
  category: FailureCategory;
  confidence: number; // 0 to 1
  anomalyScore: number; // 0 to 100
  symptoms: SymptomType[];
}

export interface FailureEvent {
  event_id: string;
  build_id: string;
  node_id: string;
  classification: FailureClassification;
  error_message: string;
  timestamp: string;
}

export interface RepairAction {
  repair_id: string;
  event_id: string;
  repair_type: string;
  params_before: Record<string, any>;
  params_after: Record<string, any>;
  success: boolean;
  duration_ms: number;
  timestamp: string;
}

export interface Checkpoint {
  checkpoint_id: string;
  build_id: string;
  node_id: string;
  layer: number;
  node_results: Record<string, any>;
  timestamp: string;
}

export type OrchestratorState =
  | 'RUNNING'
  | 'DETECTING'
  | 'CLASSIFYING'
  | 'ATTEMPTING_REPAIR'
  | 'VALIDATING'
  | 'COOLDOWN'
  | 'ESCALATING'
  | 'MANUAL_INTERVENTION';

