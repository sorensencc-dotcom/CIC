export interface PlanNodeBase {
  id: string;
  nodeType: "task" | "artifact" | "decision" | "agent_run";
  createdAt: string;
  updatedAt?: string | null;
}

export interface TaskNode extends PlanNodeBase {
  nodeType: "task";
  title: string;
  description?: string | null;
  status: string;
  contextMetadata?: Record<string, any> | null;
}

export interface ArtifactNode extends PlanNodeBase {
  nodeType: "artifact";
  path: string;
  type: string;
  checksum?: string | null;
}

export interface DecisionNode extends PlanNodeBase {
  nodeType: "decision";
  taskId: string;
  rationale?: string | null;
  optionsConsidered?: Record<string, any> | null;
  chosenOption?: string | null;
}

export interface AgentRunNode extends PlanNodeBase {
  nodeType: "agent_run";
  taskId: string;
  agentType: string;
  status: string;
  executionTrace?: Record<string, any> | null;
}

export type PlanNode = TaskNode | ArtifactNode | DecisionNode | AgentRunNode;

export interface PlanEdge {
  id: number;
  sourceId: string;
  targetId: string;
  relationType: string;
  createdAt: string;
}

export interface PlanView {
  nodes: Record<string, PlanNode>;
  edges: PlanEdge[];
}

export interface TaskHistoryEntry {
  task: TaskNode;
  decisions: DecisionNode[];
  runs: AgentRunNode[];
}

export interface PlanContextEnvelope {
  currentTaskId: string;
  parentTask?: TaskNode | null;
  taskHistory: TaskHistoryEntry[];
  activeBlockers: PlanNode[];
  contextArtifacts: ArtifactNode[];
}

export interface HybridSearchResponse {
  documents: { path: string; snippets: string[] }[];
  tasks: TaskNode[];
  decisions: DecisionNode[];
  artifacts: ArtifactNode[];
}

export interface ITorqueQueryPlanGraph {
  createTask(
    title: string,
    description?: string | null,
    status?: string,
    contextMetadata?: Record<string, any> | null,
    taskId?: string | null
  ): Promise<TaskNode>;

  updateTaskStatus(taskId: string, status: string): Promise<void>;

  searchTasks(query: string): Promise<TaskNode[]>;

  getTask(taskId: string): Promise<TaskNode>;

  getTaskDependencies(taskId: string): Promise<TaskNode[]>;

  getTaskBlockers(taskId: string): Promise<TaskNode[]>;

  getPlanView(taskId: string): Promise<PlanView>;

  recordArtifact(
    taskId: string,
    path: string,
    type: string,
    checksum?: string | null,
    artifactId?: string | null
  ): Promise<ArtifactNode>;

  recordDecision(
    taskId: string,
    rationale?: string | null,
    optionsConsidered?: Record<string, any> | null,
    chosenOption?: string | null,
    decisionId?: string | null
  ): Promise<DecisionNode>;

  recordAgentRun(
    taskId: string,
    agentType: string,
    status: string,
    executionTrace?: Record<string, any> | null,
    runId?: string | null
  ): Promise<AgentRunNode>;

  linkNodes(sourceId: string, targetId: string, relationType: string): Promise<void>;

  getNode(nodeId: string): Promise<PlanNode | null>;

  getNodeEdges(nodeId: string): Promise<PlanEdge[]>;

  // --- Orchestrator Operations ---
  submitTask(
    title: string,
    description?: string | null,
    priority?: string,
    executionPolicy?: Record<string, any> | null,
    tenant?: string,
    rbacContext?: Record<string, any> | null
  ): Promise<TaskNode>;

  delegateTask(
    taskId: string,
    title: string,
    description?: string | null,
    priority?: string,
    executionPolicy?: Record<string, any> | null
  ): Promise<TaskNode>;

  cancelTask(taskId: string): Promise<void>;

  completeTask(taskId: string): Promise<void>;

  startRun(taskId: string, agentType: string): Promise<AgentRunNode>;

  heartbeatRun(
    runId: string,
    toolCallsIncrement?: number,
    traceUpdate?: Record<string, any> | null
  ): Promise<{
    status: string;
    shouldAbort: boolean;
    reason?: string;
    toolCallsCount?: number;
    elapsedTime?: number;
  }>;

  endRun(runId: string, status: string, executionTrace?: Record<string, any> | null): Promise<void>;

  getPlanContextEnvelope(taskId: string): Promise<PlanContextEnvelope>;

  hybridSearch(
    query: string,
    groups: string[],
    tenantId: string,
    pathPrefix?: string | null,
    maxResults?: number
  ): Promise<HybridSearchResponse>;
}

