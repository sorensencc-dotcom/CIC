import { BuildGraphEngine } from '../graph-engine';
import { BuildGraph, BuildProvenance } from '../types';

describe('BuildGraphEngine', () => {
  let engine: BuildGraphEngine;
  let graph: BuildGraph;
  let provenance: BuildProvenance;

  beforeEach(() => {
    graph = {
      version: '0.7.0',
      generated_at: '2026-06-11T23:03:00Z',
      description: 'Test graph',
      nodes: [
        {
          id: 'code',
          type: 'source',
          dockerfile: null,
          runtime: 'none',
          depends_on: [],
          capabilities: ['source-root'],
          policies: []
        },
        {
          id: 'cic.ingestion',
          type: 'container',
          dockerfile: 'Dockerfile.ingestion',
          runtime: 'cpu',
          depends_on: ['code'],
          capabilities: ['ingest'],
          policies: ['cic.docker']
        },
        {
          id: 'cic.evolution',
          type: 'container',
          dockerfile: 'Dockerfile.evolution',
          runtime: 'cpu',
          depends_on: ['code'],
          capabilities: ['evolve'],
          policies: ['cic.docker']
        }
      ],
      sinks: [
        {
          id: 'cic.lineage',
          type: 'registry',
          accepts: ['*']
        }
      ]
    };

    engine = new BuildGraphEngine(graph);

    provenance = {
      git_sha: 'abc123def456',
      timestamp: new Date().toISOString(),
      sbom_ref: 'sbom-ref-123'
    };
  });

  describe('validateGraph', () => {
    it('should validate a valid graph', () => {
      const result = engine.validateGraph();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing dependency', () => {
      graph.nodes[1].depends_on.push('nonexistent');
      const result = engine.validateGraph();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect cycles', () => {
      graph.nodes[0].depends_on.push('cic.ingestion');
      const result = engine.validateGraph();
      expect(result.valid).toBe(false);
    });
  });

  describe('createExecutionPlan', () => {
    it('should create execution plan with correct order', () => {
      const plan = engine.createExecutionPlan('build-001');
      expect(plan.build_id).toBe('build-001');
      expect(plan.phase).toBe('0.7.0');
      expect(plan.nodes.length).toBe(3);
      expect(plan.execution_order.length).toBeGreaterThan(0);
    });

    it('should place code node first', () => {
      const plan = engine.createExecutionPlan('build-001');
      expect(plan.nodes[0]).toBe('code');
    });
  });

  describe('executeNode', () => {
    it('should execute node successfully', async () => {
      const result = await engine.executeNode('code', 'build-001', provenance);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle non-existent node', async () => {
      const result = await engine.executeNode('nonexistent', 'build-001', provenance);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('executePlan', () => {
    it('should execute full plan', async () => {
      const plan = engine.createExecutionPlan('build-002');
      const result = await engine.executePlan(plan, provenance);
      expect(result.success).toBe(true);
    });
  });

  describe('engines', () => {
    it('should provide access to lineage registry', () => {
      const lineage = engine.getLineageRegistry();
      expect(lineage).toBeDefined();
    });

    it('should provide access to routing engine', () => {
      const routing = engine.getRoutingEngine();
      expect(routing).toBeDefined();
    });

    it('should provide access to drift detector', () => {
      const drift = engine.getDriftDetector();
      expect(drift).toBeDefined();
    });
  });
});
