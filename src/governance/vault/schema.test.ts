import {
  GovernanceVaultRecord24_5Schema,
  VaultRecordBaseSchema,
  BuildMetadataSchema,
} from "./schema";

describe("Governance Vault Schemas", () => {
  describe("VaultRecordBaseSchema", () => {
    it("validates valid base record", () => {
      const valid = {
        vault_record_id: "8f3c7e2d-2c4a-4b0d-9c3e-1a2b4c5d6e7f",
        schema_version: "24.5.0",
        created_at: "2026-06-12T22:15:00Z",
      };

      expect(() => VaultRecordBaseSchema.parse(valid)).not.toThrow();
    });

    it("rejects invalid UUID", () => {
      const invalid = {
        vault_record_id: "not-a-uuid",
        schema_version: "24.5.0",
        created_at: "2026-06-12T22:15:00Z",
      };

      expect(() => VaultRecordBaseSchema.parse(invalid)).toThrow();
    });

    it("rejects invalid datetime", () => {
      const invalid = {
        vault_record_id: "8f3c7e2d-2c4a-4b0d-9c3e-1a2b4c5d6e7f",
        schema_version: "24.5.0",
        created_at: "2026-06-12 22:15:00",
      };

      expect(() => VaultRecordBaseSchema.parse(invalid)).toThrow();
    });
  });

  describe("BuildMetadataSchema", () => {
    it("validates valid build metadata", () => {
      const valid = {
        build_id: "build-001",
        cic_pipeline_id: "cic-24.5.0",
        git: {
          repo: "test/repo",
          branch: "main",
          commit_sha: "abc123",
        },
        environment: {
          builder_image: "cic/builder:24.5.0",
          cic_cli_version: "24.5.0",
          os: "ubuntu-22.04",
          toolchain_fingerprint: "sha256:abc",
        },
      };

      expect(() => BuildMetadataSchema.parse(valid)).not.toThrow();
    });

    it("allows optional tag", () => {
      const withTag = {
        build_id: "build-001",
        cic_pipeline_id: "cic-24.5.0",
        git: {
          repo: "test/repo",
          branch: "main",
          commit_sha: "abc123",
          tag: "v1.0.0",
        },
        environment: {
          builder_image: "cic/builder:24.5.0",
          cic_cli_version: "24.5.0",
          os: "ubuntu-22.04",
          toolchain_fingerprint: "sha256:abc",
        },
      };

      expect(() => BuildMetadataSchema.parse(withTag)).not.toThrow();
    });
  });

  describe("GovernanceVaultRecord24_5Schema", () => {
    it("validates complete record", () => {
      const complete = {
        vault_record_id: "8f3c7e2d-2c4a-4b0d-9c3e-1a2b4c5d6e7f",
        schema_version: "24.5.0",
        created_at: "2026-06-12T22:15:00Z",
        build_id: "build-001",
        cic_pipeline_id: "cic-24.5.0",
        git: {
          repo: "test/repo",
          branch: "main",
          commit_sha: "abc123",
        },
        environment: {
          builder_image: "cic/builder:24.5.0",
          cic_cli_version: "24.5.0",
          os: "ubuntu-22.04",
          toolchain_fingerprint: "sha256:abc",
        },
        sbom_ref: "sbom://build-001",
        provenance_ref: "prov://build-001",
        determinism_hash: "sha256:deadbeef",
        test_summary: {
          total: 82,
          passed: 82,
          failed: 0,
          skipped: 0,
        },
        type: "container" as const,
        coordinates: {
          group: "rewrite",
          name: "cic-ingestion",
          version: "1.0.0",
        },
        digest: "sha256:fedcba",
        size_bytes: 18432000,
        decision: "Approved" as const,
        decision_reason: "All policies satisfied",
        policy_version: "24.5.0",
        council: {
          members: [
            {
              id: "council-1",
              role: "human" as const,
              vote: "Approve" as const,
              timestamp: "2026-06-12T22:16:00Z",
              signature: "sig-aaa",
            },
          ],
          quorum_met: true,
          decision_signature: "sig-ccc",
        },
        signing_status: "Signed" as const,
        signing_key_id: "key-prod-01",
        signature_ref: "sig://artifact-001",
        signing_timestamp: "2026-06-12T22:17:00Z",
        promotion_status: "NotPromoted" as const,
        request_id: "req-001",
        ci_job_id: "ci-001",
        ip_or_node_id: "runner-01",
      };

      expect(() =>
        GovernanceVaultRecord24_5Schema.parse(complete)
      ).not.toThrow();
    });

    it("rejects record with invalid decision", () => {
      const invalid = {
        vault_record_id: "8f3c7e2d-2c4a-4b0d-9c3e-1a2b4c5d6e7f",
        schema_version: "24.5.0",
        created_at: "2026-06-12T22:15:00Z",
        build_id: "build-001",
        cic_pipeline_id: "cic-24.5.0",
        git: {
          repo: "test/repo",
          branch: "main",
          commit_sha: "abc123",
        },
        environment: {
          builder_image: "cic/builder:24.5.0",
          cic_cli_version: "24.5.0",
          os: "ubuntu-22.04",
          toolchain_fingerprint: "sha256:abc",
        },
        sbom_ref: "sbom://build-001",
        provenance_ref: "prov://build-001",
        determinism_hash: "sha256:deadbeef",
        test_summary: {
          total: 82,
          passed: 82,
          failed: 0,
          skipped: 0,
        },
        type: "container",
        coordinates: {
          group: "rewrite",
          name: "cic-ingestion",
          version: "1.0.0",
        },
        digest: "sha256:fedcba",
        size_bytes: 18432000,
        decision: "InvalidDecision",
        decision_reason: "Something went wrong",
        policy_version: "24.5.0",
        council: {
          members: [
            {
              id: "council-1",
              role: "human",
              vote: "Approve",
              timestamp: "2026-06-12T22:16:00Z",
              signature: "sig-aaa",
            },
          ],
          quorum_met: true,
          decision_signature: "sig-ccc",
        },
        signing_status: "Signed",
        signing_key_id: "key-prod-01",
        signature_ref: "sig://artifact-001",
        signing_timestamp: "2026-06-12T22:17:00Z",
        promotion_status: "NotPromoted",
        request_id: "req-001",
        ci_job_id: "ci-001",
        ip_or_node_id: "runner-01",
      };

      expect(() =>
        GovernanceVaultRecord24_5Schema.parse(invalid)
      ).toThrow();
    });
  });
});
