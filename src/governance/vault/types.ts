export interface VaultRecordBase {
  vault_record_id: string;
  schema_version: string;
  created_at: string;
}

export interface BuildMetadata {
  build_id: string;
  cic_pipeline_id: string;
  git: {
    repo: string;
    branch: string;
    commit_sha: string;
    tag?: string | null;
  };
  environment: {
    builder_image: string;
    cic_cli_version: string;
    os: string;
    toolchain_fingerprint: string;
  };
}

export interface ArtifactMetadata {
  type: "binary" | "container" | "bundle";
  coordinates: {
    group: string;
    name: string;
    version: string;
    qualifier?: string | null;
  };
  artifact_store_ref?: string | null;
  digest: string;
  size_bytes: number;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  report_ref?: string | null;
}

export interface LineageMetadata {
  sbom_ref: string;
  provenance_ref: string;
  determinism_hash: string;
  test_summary: TestSummary;
}

export interface CouncilVote {
  id: string;
  role: "human" | "service";
  vote: "Approve" | "Block" | "Abstain";
  timestamp: string;
  signature: string;
}

export interface GovernanceDecision {
  decision: "Approved" | "Blocked" | "NeedsRevision";
  decision_reason: string;
  policy_version: string;
  council: {
    members: CouncilVote[];
    quorum_met: boolean;
    decision_signature: string;
  };
}

export interface SigningRecord {
  signing_status: "Pending" | "Signed" | "Failed";
  signing_key_id?: string | null;
  signature_ref?: string | null;
  signing_timestamp?: string | null;
}

export interface PromotionRecord {
  promotion_status: "NotPromoted" | "Promoted" | "Rollback";
  target_environment?: "dev" | "staging" | "prod";
  promotion_timestamp?: string | null;
  initiator?: string | null;
}

export interface AuditEnvelope {
  request_id: string;
  ci_job_id: string;
  ip_or_node_id: string;
  extra_metadata?: {
    labels?: Record<string, string>;
  };
}

export interface GovernanceVaultRecord24_5
  extends VaultRecordBase,
    BuildMetadata,
    LineageMetadata,
    ArtifactMetadata,
    GovernanceDecision,
    SigningRecord,
    PromotionRecord,
    AuditEnvelope {}
