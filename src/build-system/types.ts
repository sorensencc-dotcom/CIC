// Phase 0.7 build system types

export interface BuildGraphNode {
  id: string;
  type: 'source' | 'container';
  dockerfile: string | null;
  runtime: 'none' | 'cpu' | 'gpu';
  depends_on: string[];
  capabilities: string[];
  policies: string[];
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
