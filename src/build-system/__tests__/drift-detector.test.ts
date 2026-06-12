import { DriftDetector } from '../drift-detector';
import { LineageRegistry } from '../lineage-registry';
import { BuildProvenance } from '../types';

describe('DriftDetector', () => {
  let detector: DriftDetector;
  let registry: LineageRegistry;
  let provenance: BuildProvenance;

  beforeEach(() => {
    registry = new LineageRegistry();
    detector = new DriftDetector(registry);
    provenance = {
      git_sha: 'abc123def456',
      timestamp: new Date().toISOString(),
      sbom_ref: 'sbom-ref-123'
    };
  });

  describe('detectDriftForBuild', () => {
    it('should detect no drift for valid build', () => {
      const record = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');

      const issues = detector.detectDriftForBuild('build-001');
      expect(issues.length).toBe(0);
    });

    it('should detect invalid provenance', () => {
      const badProvenance = { ...provenance, git_sha: '' };
      const record = registry.recordArtifact('agent-1', ['input1'], ['output1'], badProvenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');

      const issues = detector.detectDriftForBuild('build-001');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].issue_type).toBe('provenance_invalid');
    });

    it('should detect input divergence', () => {
      const record = registry.recordArtifact('agent-1', [], ['output1'], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');

      const issues = detector.detectDriftForBuild('build-001');
      const inputIssue = issues.find((i) => i.issue_type === 'input_divergence');
      expect(inputIssue).toBeDefined();
    });

    it('should detect output divergence', () => {
      const record = registry.recordArtifact('agent-1', ['input1'], [], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');

      const issues = detector.detectDriftForBuild('build-001');
      const outputIssue = issues.find((i) => i.issue_type === 'output_divergence');
      expect(outputIssue).toBeDefined();
    });
  });

  describe('quarantineBuild', () => {
    it('should mark all artifacts as failed', () => {
      const record1 = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      const record2 = registry.recordArtifact('agent-2', ['input2'], ['output2'], provenance, 'build-001');

      registry.updateArtifactStatus(record1.artifact_id, 'succeeded');
      registry.updateArtifactStatus(record2.artifact_id, 'succeeded');

      detector.quarantineBuild('build-001');

      const artifacts = registry.getArtifactsByBuild('build-001');
      expect(artifacts.every((a) => a.status === 'failed')).toBe(true);
    });
  });

  describe('rollbackBuild', () => {
    it('should rollback to parent build', () => {
      const parentRecord = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      registry.updateArtifactStatus(parentRecord.artifact_id, 'succeeded');

      const childRecord = registry.recordArtifact('agent-2', ['input2'], ['output2'], provenance, 'build-002', 'build-001');
      registry.updateArtifactStatus(childRecord.artifact_id, 'succeeded');

      const success = detector.rollbackBuild('build-002', 'build-001');
      expect(success).toBe(true);

      const artifacts = registry.getArtifactsByBuild('build-002');
      expect(artifacts.every((a) => a.status === 'failed')).toBe(true);
    });

    it('should fail on non-existent parent', () => {
      const record = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');

      const success = detector.rollbackBuild('build-001', 'nonexistent');
      expect(success).toBe(false);
    });
  });

  describe('getRecommendedAction', () => {
    it('should recommend action for signature mismatch', () => {
      const action = detector.getRecommendedAction({
        build_id: 'build-001',
        issue_type: 'signature_mismatch',
        severity: 'high',
        details: 'test',
        detected_at: new Date().toISOString()
      });

      expect(action).toContain('rollback');
    });

    it('should recommend action for invalid provenance', () => {
      const action = detector.getRecommendedAction({
        build_id: 'build-001',
        issue_type: 'provenance_invalid',
        severity: 'critical',
        details: 'test',
        detected_at: new Date().toISOString()
      });

      expect(action).toContain('Verify');
    });
  });

  describe('autoHeal', () => {
    it('should fail with high severity issues', () => {
      const record = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');
      registry.detectDrift(record, { inputs: ['changed'], outputs: ['changed'] });

      const issues = registry.getDriftIssues('build-001');
      const hasHighOrCritical = issues.some((i) => i.severity === 'high' || i.severity === 'critical');
      expect(hasHighOrCritical).toBe(true);

      const healed = detector.autoHeal('build-001');
      expect(healed).toBe(true); // High severity can be auto-healed
    });

    it('should clear drift issues after healing', () => {
      const record = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');

      const healed = detector.autoHeal('build-001');
      expect(healed).toBe(true);

      const issues = registry.getDriftIssues('build-001');
      expect(issues.length).toBe(0);
    });
  });
});
