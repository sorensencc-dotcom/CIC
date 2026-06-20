import { LineageRegistry } from '../lineage-registry';
import { BuildProvenance } from '../types';

describe('LineageRegistry', () => {
  let registry: LineageRegistry;
  let provenance: BuildProvenance;

  beforeEach(() => {
    registry = new LineageRegistry();
    provenance = {
      git_sha: 'abc123def456',
      timestamp: new Date().toISOString(),
      sbom_ref: 'sbom-ref-123'
    };
  });

  describe('recordArtifact', () => {
    it('should record artifact with correct fields', () => {
      const record = registry.recordArtifact(
        'agent-1',
        ['input1', 'input2'],
        ['output1'],
        provenance,
        'build-001'
      );

      expect(record.artifact_id).toBeDefined();
      expect(record.agent_id).toBe('agent-1');
      expect(record.inputs).toEqual(['input1', 'input2']);
      expect(record.outputs).toEqual(['output1']);
      expect(record.status).toBe('pending');
    });

    it('should generate unique artifact IDs', () => {
      const record1 = registry.recordArtifact('agent-1', [], [], provenance, 'build-001');
      const record2 = registry.recordArtifact('agent-1', [], [], provenance, 'build-001');
      expect(record1.artifact_id).not.toBe(record2.artifact_id);
    });
  });

  describe('updateArtifactStatus', () => {
    it('should update artifact status', () => {
      const record = registry.recordArtifact('agent-1', [], [], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'running');
      const updated = registry.getArtifact(record.artifact_id);
      expect(updated?.status).toBe('running');
    });

    it('should throw on non-existent artifact', () => {
      expect(() => {
        registry.updateArtifactStatus('nonexistent', 'succeeded');
      }).toThrow();
    });
  });

  describe('getArtifactsByBuild', () => {
    it('should return artifacts for given build', () => {
      registry.recordArtifact('agent-1', [], [], provenance, 'build-001');
      registry.recordArtifact('agent-2', [], [], provenance, 'build-001');
      registry.recordArtifact('agent-3', [], [], provenance, 'build-002');

      const artifacts = registry.getArtifactsByBuild('build-001');
      expect(artifacts).toHaveLength(2);
      expect(artifacts.every((a) => a.build_id === 'build-001')).toBe(true);
    });
  });

  describe('getArtifactsByAgent', () => {
    it('should return artifacts for given agent', () => {
      registry.recordArtifact('agent-1', [], [], provenance, 'build-001');
      registry.recordArtifact('agent-1', [], [], provenance, 'build-002');
      registry.recordArtifact('agent-2', [], [], provenance, 'build-003');

      const artifacts = registry.getArtifactsByAgent('agent-1');
      expect(artifacts).toHaveLength(2);
      expect(artifacts.every((a) => a.agent_id === 'agent-1')).toBe(true);
    });
  });

  describe('validateProvenance', () => {
    it('should validate correct provenance', () => {
      const record = registry.recordArtifact('agent-1', [], [], provenance, 'build-001');
      expect(registry.validateProvenance(record)).toBe(true);
    });

    it('should reject missing git_sha', () => {
      const record = registry.recordArtifact(
        'agent-1',
        [],
        [],
        { ...provenance, git_sha: '' },
        'build-001'
      );
      expect(registry.validateProvenance(record)).toBe(false);
    });
  });

  describe('detectDrift', () => {
    it('should detect signature mismatch', () => {
      const record = registry.recordArtifact(
        'agent-1',
        ['input1'],
        ['output1'],
        provenance,
        'build-001'
      );

      const issue = registry.detectDrift(record, {
        inputs: ['input2'],
        outputs: ['output1']
      });

      expect(issue).toBeDefined();
      expect(issue?.issue_type).toBe('signature_mismatch');
      expect(issue?.severity).toBe('high');
    });
  });

  describe('getDriftIssues', () => {
    it('should return all drift issues', () => {
      const record1 = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      const record2 = registry.recordArtifact('agent-2', ['input2'], ['output2'], provenance, 'build-001');

      registry.detectDrift(record1, { inputs: ['changed'], outputs: ['output1'] });
      registry.detectDrift(record2, { inputs: ['input2'], outputs: ['changed'] });

      const issues = registry.getDriftIssues('build-001');
      expect(issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('exportLineage', () => {
    it('should export lineage with correct structure', () => {
      const record = registry.recordArtifact('agent-1', ['input1'], ['output1'], provenance, 'build-001');
      registry.updateArtifactStatus(record.artifact_id, 'succeeded');

      const export_data = registry.exportLineage('build-001');
      expect(export_data).toHaveProperty('build_id', 'build-001');
      expect(export_data).toHaveProperty('artifact_count');
      expect(export_data).toHaveProperty('artifacts');
      expect(export_data).toHaveProperty('drift_issues');
    });
  });
});
