import {
  ITorqueQueryPlanGraph,
  TaskNode,
  ArtifactNode,
  DecisionNode,
  AgentRunNode,
  PlanNode,
  PlanEdge,
  PlanView,
  PlanContextEnvelope,
  HybridSearchResponse,
} from "../torquequery-sdk/plan";

export class TorqueQueryPlanClient implements ITorqueQueryPlanGraph {
  constructor(private baseUrl: string) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });

    if (!res.ok) {
      throw new Error(`TorqueQuery Plan API error: ${res.status} ${res.statusText} at ${path}`);
    }

    return (await res.json()) as T;
  }

  async createTask(
    title: string,
    description?: string | null,
    status?: string,
    contextMetadata?: Record<string, any> | null,
    taskId?: string | null
  ): Promise<TaskNode> {
    return this.request<TaskNode>("/api/plan/task/create", {
      method: "POST",
      body: JSON.stringify({
        title,
        description: description ?? null,
        status: status ?? "pending",
        contextMetadata: contextMetadata ?? null,
        taskId: taskId ?? null,
      }),
    });
  }

  async updateTaskStatus(taskId: string, status: string): Promise<void> {
    await this.request<{ status: string }>(`/api/plan/task/${taskId}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  }

  async searchTasks(query: string): Promise<TaskNode[]> {
    const params = new URLSearchParams({ query });
    return this.request<TaskNode[]>(`/api/plan/task/search?${params.toString()}`, {
      method: "GET",
    });
  }

  async getTask(taskId: string): Promise<TaskNode> {
    return this.request<TaskNode>(`/api/plan/task/${taskId}`, {
      method: "GET",
    });
  }

  async getTaskDependencies(taskId: string): Promise<TaskNode[]> {
    return this.request<TaskNode[]>(`/api/plan/task/${taskId}/dependencies`, {
      method: "GET",
    });
  }

  async getTaskBlockers(taskId: string): Promise<TaskNode[]> {
    return this.request<TaskNode[]>(`/api/plan/task/${taskId}/blockers`, {
      method: "GET",
    });
  }

  async getPlanView(taskId: string): Promise<PlanView> {
    return this.request<PlanView>(`/api/plan/task/${taskId}/view`, {
      method: "GET",
    });
  }

  async recordArtifact(
    taskId: string,
    path: string,
    type: string,
    checksum?: string | null,
    artifactId?: string | null
  ): Promise<ArtifactNode> {
    return this.request<ArtifactNode>("/api/plan/artifact/record", {
      method: "POST",
      body: JSON.stringify({
        taskId,
        path,
        type,
        checksum: checksum ?? null,
        artifactId: artifactId ?? null,
      }),
    });
  }

  async recordDecision(
    taskId: string,
    rationale?: string | null,
    optionsConsidered?: Record<string, any> | null,
    chosenOption?: string | null,
    decisionId?: string | null
  ): Promise<DecisionNode> {
    return this.request<DecisionNode>("/api/plan/decision/record", {
      method: "POST",
      body: JSON.stringify({
        taskId,
        rationale: rationale ?? null,
        optionsConsidered: optionsConsidered ?? null,
        chosenOption: chosenOption ?? null,
        decisionId: decisionId ?? null,
      }),
    });
  }

  async recordAgentRun(
    taskId: string,
    agentType: string,
    status: string,
    executionTrace?: Record<string, any> | null,
    runId?: string | null
  ): Promise<AgentRunNode> {
    return this.request<AgentRunNode>("/api/plan/agent_run/record", {
      method: "POST",
      body: JSON.stringify({
        taskId,
        agentType,
        status,
        executionTrace: executionTrace ?? null,
        runId: runId ?? null,
      }),
    });
  }

  async linkNodes(sourceId: string, targetId: string, relationType: string): Promise<void> {
    await this.request<{ status: string }>("/api/plan/edge/link", {
      method: "POST",
      body: JSON.stringify({
        sourceId,
        targetId,
        relationType,
      }),
    });
  }

  async getNode(nodeId: string): Promise<PlanNode | null> {
    try {
      return await this.request<PlanNode>(`/api/plan/node/${nodeId}`, {
        method: "GET",
      });
    } catch (err) {
      // Return null on 404
      if (err instanceof Error && err.message.includes("404")) {
        return null;
      }
      throw err;
    }
  }

  async getNodeEdges(nodeId: string): Promise<PlanEdge[]> {
    return this.request<PlanEdge[]>(`/api/plan/node/${nodeId}/edges`, {
      method: "GET",
    });
  }

  // --- Orchestrator Operations ---
  async submitTask(
    title: string,
    description?: string | null,
    priority?: string,
    executionPolicy?: Record<string, any> | null,
    tenant?: string,
    rbacContext?: Record<string, any> | null
  ): Promise<TaskNode> {
    return this.request<TaskNode>("/api/orchestrator/task/submit", {
      method: "POST",
      body: JSON.stringify({
        title,
        description: description ?? null,
        priority: priority ?? "normal",
        executionPolicy: executionPolicy ?? null,
        tenant: tenant ?? "default",
        rbacContext: rbacContext ?? null,
      }),
    });
  }

  async delegateTask(
    taskId: string,
    title: string,
    description?: string | null,
    priority?: string,
    executionPolicy?: Record<string, any> | null
  ): Promise<TaskNode> {
    return this.request<TaskNode>(`/api/orchestrator/task/${taskId}/delegate`, {
      method: "POST",
      body: JSON.stringify({
        title,
        description: description ?? null,
        priority: priority ?? "normal",
        executionPolicy: executionPolicy ?? null,
      }),
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.request<{ status: string }>(`/api/orchestrator/task/${taskId}/cancel`, {
      method: "POST",
    });
  }

  async completeTask(taskId: string): Promise<void> {
    await this.request<{ status: string }>(`/api/orchestrator/task/${taskId}/complete`, {
      method: "POST",
    });
  }

  async startRun(taskId: string, agentType: string): Promise<AgentRunNode> {
    return this.request<AgentRunNode>("/api/orchestrator/run/start", {
      method: "POST",
      body: JSON.stringify({ taskId, agentType }),
    });
  }

  async heartbeatRun(
    runId: string,
    toolCallsIncrement?: number,
    traceUpdate?: Record<string, any> | null
  ): Promise<{
    status: string;
    shouldAbort: boolean;
    reason?: string;
    toolCallsCount?: number;
    elapsedTime?: number;
  }> {
    return this.request<{
      status: string;
      shouldAbort: boolean;
      reason?: string;
      toolCallsCount?: number;
      elapsedTime?: number;
    }>(`/api/orchestrator/run/${runId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({
        toolCallsIncrement: toolCallsIncrement ?? 0,
        traceUpdate: traceUpdate ?? null,
      }),
    });
  }

  async endRun(runId: string, status: string, executionTrace?: Record<string, any> | null): Promise<void> {
    await this.request<{ status: string }>(`/api/orchestrator/run/${runId}/end`, {
      method: "POST",
      body: JSON.stringify({
        status,
        executionTrace: executionTrace ?? null,
      }),
    });
  }

  async getPlanContextEnvelope(taskId: string): Promise<PlanContextEnvelope> {
    return this.request<PlanContextEnvelope>(`/api/orchestrator/task/${taskId}/context`, {
      method: "GET",
    });
  }

  async hybridSearch(
    query: string,
    groups: string[],
    tenantId: string,
    pathPrefix?: string | null,
    maxResults?: number
  ): Promise<HybridSearchResponse> {
    return this.request<HybridSearchResponse>("/api/fs/hybrid-search", {
      method: "POST",
      body: JSON.stringify({
        user: {
          userId: "sdk-client",
          groups,
          tenantId,
        },
        query,
        pathPrefix: pathPrefix ?? null,
        maxResults: maxResults ?? 10,
      }),
    });
  }
}

export const planClient = new TorqueQueryPlanClient("http://localhost:8000");


