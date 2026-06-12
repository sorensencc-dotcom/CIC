import { ArtifactRecord, BuildProvenance, DriftIssue } from './types';
import * as crypto from 'crypto';

export class LineageRegistry {
  private artifacts: Map<string, ArtifactRecord> = new Map();
  private driftIssues: DriftIssue[] = [];

  recordArtifact(
    agent_id: string,
    inputs: string[],
    outputs: string[],
    provenance: BuildProvenance,
    build_id: string,
    parent_build_id?: string
  ): ArtifactRecord {
    const artifact_id = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const drift_signature = this.computeSignature(inputs, outputs, provenance);

    const record: ArtifactRecord = {
      artifact_id,
      agent_id,
      version: '1.0.0',
      build_id,
      inputs,
      outputs,
      provenance,
      drift_signature,
      parent_build_id: parent_build_id || null,
      created_at: new Date().toISOString(),
      status: 'pending'
    };

    this.artifacts.set(artifact_id, record);
    return record;
  }

  updateArtifactStatus(
    artifact_id: string,
    status: 'running' | 'succeeded' | 'failed',
    error?: Error
  ): void {
    const record = this.artifacts.get(artifact_id);
    if (!record) throw new Error(`Artifact not found: ${artifact_id}`);

    record.status = status;
    record.completed_at = new Date().toISOString();

    if (status === 'failed' && error) {
      console.error(`Artifact failed: ${artifact_id}`, error.message);
    }
  }

  getArtifact(artifact_id: string): ArtifactRecord | undefined {
    return this.artifacts.get(artifact_id);
  }

  getArtifactsByBuild(build_id: string): ArtifactRecord[] {
    return Array.from(this.artifacts.values()).filter((a) => a.build_id === build_id);
  }

  getArtifactsByAgent(agent_id: string): ArtifactRecord[] {
    return Array.from(this.artifacts.values()).filter((a) => a.agent_id === agent_id);
  }

  validateProvenance(record: ArtifactRecord): boolean {
    const { provenance } = record;
    return (
      provenance.git_sha !== '' &&
      provenance.timestamp !== '' &&
      provenance.sbom_ref !== ''
    );
  }

  detectDrift(record: ArtifactRecord, currentState: { inputs: string[]; outputs: string[] }): DriftIssue | null {
    const currentSignature = this.computeSignature(
      currentState.inputs,
      currentState.outputs,
      record.provenance
    );

    if (currentSignature !== record.drift_signature) {
      const issue: DriftIssue = {
        build_id: record.build_id,
        issue_type: 'signature_mismatch',
        severity: 'high',
        details: `Signature mismatch for ${record.artifact_id}: expected ${record.drift_signature}, got ${currentSignature}`,
        detected_at: new Date().toISOString()
      };
      this.driftIssues.push(issue);
      return issue;
    }

    return null;
  }

  private computeSignature(inputs: string[], outputs: string[], provenance: BuildProvenance): string {
    const data = JSON.stringify({
      inputs: inputs.sort(),
      outputs: outputs.sort(),
      git_sha: provenance.git_sha,
      timestamp: provenance.timestamp
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  getDriftIssues(build_id?: string): DriftIssue[] {
    if (!build_id) return this.driftIssues;
    return this.driftIssues.filter((issue) => issue.build_id === build_id);
  }

  clearDriftIssues(build_id?: string): void {
    if (!build_id) {
      this.driftIssues = [];
    } else {
      this.driftIssues = this.driftIssues.filter((issue) => issue.build_id !== build_id);
    }
  }

  exportLineage(build_id: string): object {
    const artifacts = this.getArtifactsByBuild(build_id);
    return {
      build_id,
      artifact_count: artifacts.length,
      artifacts: artifacts.map((a) => ({
        artifact_id: a.artifact_id,
        agent_id: a.agent_id,
        status: a.status,
        provenance: a.provenance,
        drift_signature: a.drift_signature
      })),
      drift_issues: this.getDriftIssues(build_id)
    };
  }
}
