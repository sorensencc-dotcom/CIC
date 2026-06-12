import { BuildGraph, BuildGraphNode, BuildExecutionPlan, NodeExecutionContext, BuildProvenance } from './types';
import { LineageRegistry } from './lineage-registry';
import { RoutingEngine } from './routing-engine';
import { DriftDetector } from './drift-detector';

export class BuildGraphEngine {
  private graph: BuildGraph;
  private lineage: LineageRegistry;
  private routing: RoutingEngine;
  private drift: DriftDetector;
  private executionContexts: Map<string, NodeExecutionContext> = new Map();

  constructor(graph: BuildGraph) {
    this.graph = graph;
    this.lineage = new LineageRegistry();
    this.routing = new RoutingEngine();
    this.drift = new DriftDetector(this.lineage);
  }

  validateGraph(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for cycles
    if (this.hasCycle()) {
      errors.push('Graph contains a cycle');
    }

    // Validate dependencies
    for (const node of this.graph.nodes) {
      for (const dep of node.depends_on) {
        const depNode = this.graph.nodes.find((n) => n.id === dep);
        if (!depNode) {
          errors.push(`Node ${node.id} depends on non-existent node ${dep}`);
        }
      }
    }

    // Validate sinks
    for (const sink of this.graph.sinks) {
      for (const acceptsNode of sink.accepts) {
        if (acceptsNode !== '*') {
          const node = this.graph.nodes.find((n) => n.id === acceptsNode);
          if (!node) {
            errors.push(`Sink ${sink.id} accepts non-existent node ${acceptsNode}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  createExecutionPlan(build_id: string): BuildExecutionPlan {
    const sortedNodes = this.topologicalSort();
    const layers: string[][] = [];
    const visited = new Set<string>();

    for (const nodeId of sortedNodes) {
      if (visited.has(nodeId)) continue;

      const node = this.graph.nodes.find((n) => n.id === nodeId)!;
      const layer = this.getExecutionLayer(nodeId, visited);
      layers.push(layer);

      layer.forEach((n) => visited.add(n));
    }

    return {
      build_id,
      phase: this.graph.version,
      nodes: sortedNodes,
      execution_order: layers,
      created_at: new Date().toISOString()
    };
  }

  async executeNode(
    nodeId: string,
    build_id: string,
    provenance: BuildProvenance
  ): Promise<{ success: boolean; error?: Error | null }> {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return { success: false, error: new Error(`Node not found: ${nodeId}`) };

    const context: NodeExecutionContext = {
      node_id: nodeId,
      build_id,
      phase: this.graph.version,
      inputs: new Map(),
      outputs: new Map(),
      start_time: new Date(),
      status: 'running'
    };

    this.executionContexts.set(nodeId, context);

    try {
      // Resolve inputs from dependencies
      for (const dep of node.depends_on) {
        const depContext = this.executionContexts.get(dep);
        if (depContext && depContext.status === 'succeeded') {
          depContext.outputs.forEach((value, key) => context.inputs.set(`${dep}:${key}`, value));
        }
      }

      // Record artifact in lineage
      const artifact = this.lineage.recordArtifact(
        nodeId,
        Array.from(context.inputs.keys()),
        Array.from(context.outputs.keys()),
        provenance,
        build_id,
        undefined
      );

      this.lineage.updateArtifactStatus(artifact.artifact_id, 'running');

      // Simulate node execution
      context.outputs.set(`${nodeId}:output`, `artifact-${build_id}-${nodeId}`);

      context.status = 'succeeded';
      context.end_time = new Date();

      this.lineage.updateArtifactStatus(artifact.artifact_id, 'succeeded');

      return { success: true };
    } catch (error) {
      context.status = 'failed';
      context.end_time = new Date();
      context.error = error as Error;

      // Retrieve the artifact that was created before the error
      const artifacts = this.lineage.getArtifactsByBuild(build_id);
      const artifact = artifacts.find((a) => a.agent_id === nodeId);
      if (artifact) {
        this.lineage.updateArtifactStatus(
          artifact.artifact_id,
          'failed',
          error as Error
        );
      }

      return { success: false, error: error as Error };
    }
  }

  async executePlan(plan: BuildExecutionPlan, provenance: BuildProvenance): Promise<{ success: boolean; errors: Error[] }> {
    const errors: Error[] = [];

    for (const layer of plan.execution_order) {
      for (const nodeId of layer) {
        const result = await this.executeNode(nodeId, plan.build_id, provenance);
        if (!result.success && result.error) {
          errors.push(result.error);
        }
      }
    }

    // Detect drift
    const driftIssues = this.drift.detectDriftForBuild(plan.build_id);
    if (driftIssues.length > 0) {
      console.warn(`Drift detected in build ${plan.build_id}:`, driftIssues);
      if (!this.drift.autoHeal(plan.build_id)) {
        errors.push(new Error('Failed to auto-heal drift issues'));
      }
    }

    return {
      success: errors.length === 0,
      errors
    };
  }

  getLineageRegistry(): LineageRegistry {
    return this.lineage;
  }

  getRoutingEngine(): RoutingEngine {
    return this.routing;
  }

  getDriftDetector(): DriftDetector {
    return this.drift;
  }

  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        for (const dep of node.depends_on) {
          visit(dep);
        }
      }

      result.push(nodeId);
    };

    for (const node of this.graph.nodes) {
      visit(node.id);
    }

    return result;
  }

  private hasCycle(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycleDFS = (nodeId: string): boolean => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        for (const dep of node.depends_on) {
          if (!visited.has(dep)) {
            if (hasCycleDFS(dep)) return true;
          } else if (recStack.has(dep)) {
            return true;
          }
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const node of this.graph.nodes) {
      if (!visited.has(node.id)) {
        if (hasCycleDFS(node.id)) return true;
      }
    }

    return false;
  }

  private getExecutionLayer(nodeId: string, visited: Set<string>): string[] {
    const layer: string[] = [];
    const node = this.graph.nodes.find((n) => n.id === nodeId);

    if (!node) return layer;

    // Can execute in parallel if all dependencies are visited
    if (node.depends_on.every((dep) => visited.has(dep))) {
      layer.push(nodeId);
    }

    return layer;
  }
}
