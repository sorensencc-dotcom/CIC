import { Checkpoint } from './types';

export class StateRecoveryManager {
  private checkpoints: Map<string, Checkpoint[]> = new Map();

  createCheckpoint(
    buildId: string,
    nodeId: string,
    layer: number,
    nodeResults: Map<string, any>
  ): Checkpoint {
    const checkpointId = `chk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const resultsCopy = JSON.parse(
      JSON.stringify(
        Array.from(nodeResults.entries()).reduce((acc, [k, v]) => {
          acc[k] = v;
          return acc;
        }, {} as Record<string, any>)
      )
    );

    const checkpoint: Checkpoint = {
      checkpoint_id: checkpointId,
      build_id: buildId,
      node_id: nodeId,
      layer,
      node_results: resultsCopy,
      timestamp: new Date().toISOString(),
    };

    const list = this.checkpoints.get(buildId) || [];
    list.push(checkpoint);
    this.checkpoints.set(buildId, list);

    return checkpoint;
  }

  getLatestCheckpoint(buildId: string): Checkpoint | undefined {
    const list = this.checkpoints.get(buildId);
    if (!list || list.length === 0) return undefined;
    return list[list.length - 1];
  }

  rollbackLevel1(
    buildId: string,
    nodeId: string,
    nodeResults: Map<string, any>,
    dryRun = false
  ): { affectedNodes: string[]; committed: boolean } {
    const affectedNodes = [nodeId];
    if (!dryRun) {
      nodeResults.delete(nodeId);
    }
    return { affectedNodes, committed: !dryRun };
  }

  rollbackLevel2(
    buildId: string,
    nodeId: string,
    nodeResults: Map<string, any>,
    dagNodes: { id: string; depends_on: string[] }[],
    dryRun = false
  ): { affectedNodes: string[]; committed: boolean } {
    const affectedNodes: string[] = [nodeId];

    // Cascading downstream traversal to find dependents
    const findDependents = (currentId: string) => {
      for (const node of dagNodes) {
        if (node.depends_on.includes(currentId) && !affectedNodes.includes(node.id)) {
          affectedNodes.push(node.id);
          findDependents(node.id);
        }
      }
    };
    findDependents(nodeId);

    if (!dryRun) {
      for (const id of affectedNodes) {
        nodeResults.delete(id);
      }
    }

    return { affectedNodes, committed: !dryRun };
  }

  rollbackLevel3(
    buildId: string,
    nodeResults: Map<string, any>,
    dryRun = false
  ): { affectedNodes: string[]; committed: boolean } {
    const affectedNodes = Array.from(nodeResults.keys());
    if (!dryRun) {
      nodeResults.clear();
    }
    return { affectedNodes, committed: !dryRun };
  }
}
