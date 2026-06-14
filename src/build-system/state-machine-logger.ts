// src/build-system/state-machine-logger.ts

import { OrchestratorState } from './self-healing-events';

export interface StateTransition {
  buildId: string;
  nodeId: string;
  from: OrchestratorState;
  to: OrchestratorState;
  timestamp: string;
}

export interface StateMachineLogger {
  log(transition: StateTransition): void;
}

export class ConsoleStateMachineLogger implements StateMachineLogger {
  log(t: StateTransition): void {
    // e.g. [2026-06-12T23:47:00Z] build-1 node-3 RUNNING -> DETECTING
    // eslint-disable-next-line no-console
    console.log(
      `[${t.timestamp}] ${t.buildId} ${t.nodeId} ${t.from} -> ${t.to}`,
    );
  }
}
