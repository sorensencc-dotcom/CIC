import { LineageRegistry } from './lineage-registry';
import { DriftIssue } from './types';

export class DriftDetector {
  constructor(private lineage: LineageRegistry) {}

  detectDriftForBuild(build_id: string): DriftIssue[] {
    const artifacts = this.lineage.getArtifactsByBuild(build_id);
    const issues: DriftIssue[] = [];

    for (const artifact of artifacts) {
      // Validate provenance
      if (!this.lineage.validateProvenance(artifact)) {
        issues.push({
          build_id,
          issue_type: 'provenance_invalid',
          severity: 'critical',
          details: `Invalid provenance for ${artifact.artifact_id}`,
          detected_at: new Date().toISOString()
        });
      }

      // Check for input/output divergence
      if (artifact.inputs.length === 0 && artifact.status === 'succeeded') {
        issues.push({
          build_id,
          issue_type: 'input_divergence',
          severity: 'medium',
          details: `Artifact ${artifact.artifact_id} has no inputs despite success`,
          detected_at: new Date().toISOString()
        });
      }

      if (artifact.outputs.length === 0 && artifact.status === 'succeeded') {
        issues.push({
          build_id,
          issue_type: 'output_divergence',
          severity: 'medium',
          details: `Artifact ${artifact.artifact_id} has no outputs despite success`,
          detected_at: new Date().toISOString()
        });
      }
    }

    return issues;
  }

  quarantineBuild(build_id: string): void {
    const artifacts = this.lineage.getArtifactsByBuild(build_id);
    for (const artifact of artifacts) {
      if (artifact.status !== 'failed') {
        this.lineage.updateArtifactStatus(artifact.artifact_id, 'failed', new Error('Build quarantined due to drift'));
      }
    }
  }

  rollbackBuild(build_id: string, parent_build_id: string): boolean {
    const parentArtifacts = this.lineage.getArtifactsByBuild(parent_build_id);
    if (parentArtifacts.length === 0) {
      console.error(`Parent build not found: ${parent_build_id}`);
      return false;
    }

    // Mark current build as failed
    this.quarantineBuild(build_id);

    console.log(`Rolled back build ${build_id} to parent ${parent_build_id}`);
    return true;
  }

  getRecommendedAction(issue: DriftIssue): string {
    switch (issue.issue_type) {
      case 'signature_mismatch':
        return 'Quarantine and rollback to last known-good build';
      case 'provenance_invalid':
        return 'Verify git commit and SBOM reference, retry build';
      case 'input_divergence':
        return 'Review input sources and regenerate';
      case 'output_divergence':
        return 'Regenerate outputs from latest inputs';
      default:
        return 'Manual investigation required';
    }
  }

  autoHeal(build_id: string): boolean {
    const issues = this.lineage.getDriftIssues(build_id);
    if (issues.length === 0) return true;

    console.log(`Auto-healing build ${build_id} with ${issues.length} issues`);

    // Critical issues cannot be auto-healed
    const criticalIssues = issues.filter((i) => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      console.warn('Critical issues detected, cannot auto-heal');
      return false;
    }

    // Clear drift issues after healing attempt
    this.lineage.clearDriftIssues(build_id);
    return true;
  }
}
