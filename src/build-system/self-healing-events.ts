// src/build-system/self-healing-events.ts

import { FailureEvent } from './failure-detector';
import { RepairAction } from './auto-repair-engine';

export type OrchestratorState =
  | 'RUNNING'
  | 'DETECTING'
  | 'CLASSIFYING'
  | 'ATTEMPTING_REPAIR'
  | 'VALIDATING'
  | 'ESCALATING'
  | 'MANUAL_INTERVENTION';

export interface EscalationEvent {
  type: 'ESCALATION';
  buildId: string;
  nodeId: string;
  state: OrchestratorState; // should be 'ESCALATING'
  failure: FailureEvent;
  repairActionsApplied: RepairAction[];
  nodeRetryCount: number;
  buildRetryCount: number;
  timestamp: string;
  escalationReason: string;
  suggestedNextSteps?: string;
}

export interface ManualInterventionEvent {
  type: 'MANUAL_INTERVENTION';
  buildId: string;
  nodeId: string;
  failure: FailureEvent;
  repairActionsApplied: RepairAction[];
  nodeRetryCount: number;
  buildRetryCount: number;
  timestamp: string;
  owner?: string; // team / on-call
  notes?: string;
}

export type SelfHealingEvent = EscalationEvent | ManualInterventionEvent;

export interface EventSink {
  emit(event: SelfHealingEvent): Promise<void>;
}
