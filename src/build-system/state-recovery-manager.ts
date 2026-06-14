// src/build-system/state-recovery-manager.ts

export interface CheckpointId {
  buildId: string;
  nodeId?: string;
  subtreeRootId?: string;
}

export interface SerializedState {
  // opaque blob; you decide the shape
  data: unknown;
  createdAt: string;
}

export interface StateStore {
  save(id: CheckpointId, state: SerializedState): Promise<void>;
  load(id: CheckpointId): Promise<SerializedState | null>;
  delete(id: CheckpointId): Promise<void>;
}

export class InMemoryStateStore implements StateStore {
  private readonly store = new Map<string, SerializedState>();

  private getKey(id: CheckpointId): string {
    return `${id.buildId}:${id.nodeId || 'none'}:${id.subtreeRootId || 'none'}`;
  }

  async save(id: CheckpointId, state: SerializedState): Promise<void> {
    this.store.set(this.getKey(id), state);
  }

  async load(id: CheckpointId): Promise<SerializedState | null> {
    return this.store.get(this.getKey(id)) || null;
  }

  async delete(id: CheckpointId): Promise<void> {
    this.store.delete(this.getKey(id));
  }

  // for testing
  getSize(): number {
    return this.store.size;
  }
}

export class StateRecoveryManager {
  constructor(private readonly store: StateStore) {}

  async saveCheckpoint(id: CheckpointId, state: unknown): Promise<void> {
    const serialized: SerializedState = {
      data: state,
      createdAt: new Date().toISOString(),
    };

    await this.store.save(id, serialized);
  }

  async restoreCheckpoint(id: CheckpointId): Promise<SerializedState | null> {
    return this.store.load(id);
  }

  async rollbackLevel1(buildId: string, nodeId: string): Promise<void> {
    const id: CheckpointId = { buildId, nodeId };
    const checkpoint = await this.store.load(id);
    if (!checkpoint) return;

    // TODO: apply checkpoint.data back into your graph engine
  }

  async rollbackLevel2(buildId: string, subtreeRootId: string): Promise<void> {
    const id: CheckpointId = { buildId, subtreeRootId };
    const checkpoint = await this.store.load(id);
    if (!checkpoint) return;

    // TODO: apply subtree checkpoint to graph engine
  }

  async rollbackLevel3(buildId: string): Promise<void> {
    const id: CheckpointId = { buildId };
    const checkpoint = await this.store.load(id);
    if (!checkpoint) return;

    // TODO: reset entire build graph and caches from checkpoint
  }
}
