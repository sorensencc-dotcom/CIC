import { computeVaultRecordDigest, writeGovernanceVaultRecord } from "./write";
import { GovernanceVaultRecord24_5 } from "./types";

describe("Governance Vault Write", () => {
  describe("computeVaultRecordDigest", () => {
    it("computes deterministic sha256 digest", () => {
      const record: Omit<GovernanceVaultRecord24_5, "vault_record_id"> = {
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
        decision: "Approved",
        decision_reason: "All policies satisfied",
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

      const digest1 = computeVaultRecordDigest(record);
      const digest2 = computeVaultRecordDigest(record);

      expect(digest1).toBe(digest2);
      expect(digest1).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("produces different digests for different records", () => {
      const base: Omit<GovernanceVaultRecord24_5, "vault_record_id"> = {
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
        decision: "Approved",
        decision_reason: "All policies satisfied",
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

      const digest1 = computeVaultRecordDigest(base);
      const modified = {
        ...base,
        decision: "Blocked" as const,
      };
      const digest2 = computeVaultRecordDigest(modified);

      expect(digest1).not.toBe(digest2);
    });

    it("handles nested object key ordering", () => {
      const record1 = {
        a: 1,
        b: {
          x: 10,
          y: 20,
        },
      };

      const record2 = {
        b: {
          y: 20,
          x: 10,
        },
        a: 1,
      };

      const digest1 = computeVaultRecordDigest(record1);
      const digest2 = computeVaultRecordDigest(record2);

      expect(digest1).toBe(digest2);
    });
  });

  describe("writeGovernanceVaultRecord", () => {
    it("validates record against schema", async () => {
      const invalidRecord = {
        vault_record_id: "not-a-uuid",
        schema_version: "24.5.0",
      };

      await expect(
        writeGovernanceVaultRecord(invalidRecord, {
          endpoint: "https://vault.local/api/v1/records",
          apiKey: "test-key",
        })
      ).rejects.toThrow();
    });

    it("attaches vault_digest to payload", async () => {
      const record: GovernanceVaultRecord24_5 = {
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
        decision: "Approved",
        decision_reason: "All policies satisfied",
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

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "vault-record-001" }),
      });

      const result = await writeGovernanceVaultRecord(record, {
        endpoint: "https://vault.local/api/v1/records",
        apiKey: "test-key",
      });

      expect(result.id).toBe("vault-record-001");
      expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "Authorization": "Bearer test-key",
          }),
        })
      );
    });
  });
});
