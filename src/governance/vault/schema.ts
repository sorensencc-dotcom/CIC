import { z } from "zod";

export const VaultRecordBaseSchema = z.object({
  vault_record_id: z.string().uuid(),
  schema_version: z.string(),
  created_at: z.string().datetime(),
});

export const BuildMetadataSchema = z.object({
  build_id: z.string(),
  cic_pipeline_id: z.string(),
  git: z.object({
    repo: z.string(),
    branch: z.string(),
    commit_sha: z.string(),
    tag: z.string().nullable().optional(),
  }),
  environment: z.object({
    builder_image: z.string(),
    cic_cli_version: z.string(),
    os: z.string(),
    toolchain_fingerprint: z.string(),
  }),
});

export const ArtifactMetadataSchema = z.object({
  type: z.enum(["binary", "container", "bundle"]),
  coordinates: z.object({
    group: z.string(),
    name: z.string(),
    version: z.string(),
    qualifier: z.string().nullable().optional(),
  }),
  artifact_store_ref: z.string().nullable().optional(),
  digest: z.string(),
  size_bytes: z.number().int().nonnegative(),
});

export const TestSummarySchema = z.object({
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  report_ref: z.string().nullable().optional(),
});

export const LineageMetadataSchema = z.object({
  sbom_ref: z.string(),
  provenance_ref: z.string(),
  determinism_hash: z.string(),
  test_summary: TestSummarySchema,
});

export const CouncilVoteSchema = z.object({
  id: z.string(),
  role: z.enum(["human", "service"]),
  vote: z.enum(["Approve", "Block", "Abstain"]),
  timestamp: z.string().datetime(),
  signature: z.string(),
});

export const GovernanceDecisionSchema = z.object({
  decision: z.enum(["Approved", "Blocked", "NeedsRevision"]),
  decision_reason: z.string(),
  policy_version: z.string(),
  council: z.object({
    members: z.array(CouncilVoteSchema),
    quorum_met: z.boolean(),
    decision_signature: z.string(),
  }),
});

export const SigningRecordSchema = z.object({
  signing_status: z.enum(["Pending", "Signed", "Failed"]),
  signing_key_id: z.string().nullable().optional(),
  signature_ref: z.string().nullable().optional(),
  signing_timestamp: z.string().datetime().nullable().optional(),
});

export const PromotionRecordSchema = z.object({
  promotion_status: z.enum(["NotPromoted", "Promoted", "Rollback"]),
  target_environment: z.enum(["dev", "staging", "prod"]).optional(),
  promotion_timestamp: z.string().datetime().nullable().optional(),
  initiator: z.string().optional(),
});

export const AuditEnvelopeSchema = z.object({
  request_id: z.string(),
  ci_job_id: z.string(),
  ip_or_node_id: z.string(),
  extra_metadata: z
    .object({
      labels: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export const GovernanceVaultRecord24_5Schema = VaultRecordBaseSchema
  .merge(BuildMetadataSchema)
  .merge(LineageMetadataSchema)
  .merge(ArtifactMetadataSchema)
  .merge(GovernanceDecisionSchema)
  .merge(SigningRecordSchema)
  .merge(PromotionRecordSchema)
  .merge(AuditEnvelopeSchema);
