import threading
import time
from typing import Dict, List, Any, Optional
from src.fs.plan_graph import PlanGraphStore

class CICOrchestrator:
    def __init__(self, plan_graph: PlanGraphStore):
        self.plan_graph = plan_graph
        self.lock = threading.Lock()
        
        # Concurrency settings
        self.max_global_concurrency = 10
        self.max_agent_concurrency = {
            "cicBuildAgent": 3,
            "default": 2
        }
        
        # In-memory tracking of running tasks/runs
        self.running_tasks: Dict[str, Dict[str, Any]] = {}  # task_id -> task details
        self.running_agent_runs: Dict[str, Dict[str, Any]] = {}  # run_id -> run details

    def submit_task(self, title: str, description: Optional[str] = None,
                    priority: str = "normal", execution_policy: Optional[Dict[str, Any]] = None,
                    tenant: str = "default", rbac_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Submits a new root task to the orchestrator, enforcing concurrency limits.
        """
        with self.lock:
            # Check concurrency
            active_count = len(self.running_tasks)
            status = "pending"
            if active_count >= self.max_global_concurrency:
                status = "blocked" # Queue limit reached

            # Set default execution policy budgets
            policy = execution_policy or {}
            budget = {
                "max_tool_calls": policy.get("max_tool_calls", 50),
                "max_time_seconds": policy.get("max_time_seconds", 300),
                "tool_calls_count": 0,
                "start_time": time.time()
            }

            # Merge rbac and policy into contextMetadata
            meta = {
                "priority": priority,
                "tenant": tenant,
                "rbacContext": rbac_context or {},
                "executionPolicy": budget,
                "delegated_by": None
            }

            task = self.plan_graph.create_task(
                title=title,
                description=description,
                status=status,
                context_metadata=meta
            )

            if status == "pending":
                # Move to running
                self.running_tasks[task["id"]] = {
                    "id": task["id"],
                    "agent_type": "root",
                    "budget": budget,
                    "meta": meta
                }
                self.plan_graph.update_task_status(task["id"], "running")
                task["status"] = "running"

            return task

    def delegate_task(self, parent_task_id: str, title: str, description: Optional[str] = None,
                      priority: str = "normal", execution_policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Delegates a subtask from an existing task.
        Strictly inherits tenant, RBAC context, and inherits/limits execution policy budgets.
        """
        with self.lock:
            parent_node = self.plan_graph.get_node(parent_task_id)
            if not parent_node or parent_node["nodeType"] != "task":
                raise ValueError(f"Parent task '{parent_task_id}' not found.")

            parent_meta = parent_node.get("contextMetadata") or {}
            tenant = parent_meta.get("tenant", "default")
            rbac_context = parent_meta.get("rbacContext", {})
            parent_budget = parent_meta.get("executionPolicy", {})

            # Child budget inherits and can be further restricted, but cannot exceed parent
            child_policy = execution_policy or {}
            max_tools = min(child_policy.get("max_tool_calls", 50), parent_budget.get("max_tool_calls", 50))
            max_time = min(child_policy.get("max_time_seconds", 300), parent_budget.get("max_time_seconds", 300))

            budget = {
                "max_tool_calls": max_tools,
                "max_time_seconds": max_time,
                "tool_calls_count": 0,
                "start_time": time.time()
            }

            meta = {
                "priority": priority,
                "tenant": tenant,
                "rbacContext": rbac_context,
                "executionPolicy": budget,
                "delegated_by": parent_task_id
            }

            # Check global concurrency
            active_count = len(self.running_tasks)
            status = "pending"
            if active_count >= self.max_global_concurrency:
                status = "blocked"

            child = self.plan_graph.create_task(
                title=title,
                description=description,
                status=status,
                context_metadata=meta
            )

            # Link Parent -> Child as subtask/delegates
            self.plan_graph.link_nodes(parent_task_id, child["id"], "blocked_by")

            if status == "pending":
                self.running_tasks[child["id"]] = {
                    "id": child["id"],
                    "agent_type": "delegate",
                    "budget": budget,
                    "meta": meta
                }
                self.plan_graph.update_task_status(child["id"], "running")
                child["status"] = "running"

            return child

    def record_run_start(self, task_id: str, agent_type: str) -> Dict[str, Any]:
        """
        Starts an agent run for a task, verifying concurrency limits for that agent type.
        """
        with self.lock:
            # Verify task is active
            task_node = self.plan_graph.get_node(task_id)
            if not task_node or task_node["nodeType"] != "task":
                raise ValueError(f"Task '{task_id}' not found.")

            if task_node["status"] not in ("running", "pending"):
                raise ValueError(f"Task '{task_id}' is in status '{task_node['status']}', cannot start agent run.")

            # Concurrency limit check by agent type
            agent_limit = self.max_agent_concurrency.get(agent_type, self.max_agent_concurrency["default"])
            running_of_type = sum(1 for r in self.running_agent_runs.values() if r["agent_type"] == agent_type)
            
            if running_of_type >= agent_limit:
                raise ValueError(f"Concurrency limit reached for agent type '{agent_type}'.")

            # Create agent run in DB
            run = self.plan_graph.record_agent_run(
                task_id=task_id,
                agent_type=agent_type,
                status="running",
                execution_trace={"tool_calls": [], "start_time": time.time()}
            )

            self.running_agent_runs[run["id"]] = {
                "id": run["id"],
                "task_id": task_id,
                "agent_type": agent_type,
                "start_time": time.time(),
                "tool_calls_count": 0
            }

            return run

    def record_heartbeat(self, run_id: str, tool_calls_increment: int = 0, trace_update: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Heartbeat listener: updates run progress and checks tool/time budget consumption.
        Throws error or returns abort signal if budgets are exceeded.
        """
        with self.lock:
            run_details = self.running_agent_runs.get(run_id)
            if not run_details:
                # Run might have been cancelled
                return {"status": "cancelled", "should_abort": True, "reason": "Agent run not active or was cancelled."}

            task_id = run_details["task_id"]
            task_node = self.plan_graph.get_node(task_id)
            if not task_node or task_node["status"] == "cancelled":
                # Task cancelled, trigger run cancellation
                self.record_run_end(run_id, "cancelled", {"reason": "Parent task cancelled"})
                return {"status": "cancelled", "should_abort": True, "reason": "Task cancelled."}

            meta = task_node.get("contextMetadata") or {}
            budget = meta.get("executionPolicy") or {}

            # Update usage metrics
            run_details["tool_calls_count"] += tool_calls_increment
            elapsed_time = time.time() - run_details["start_time"]

            # Enforce budgets
            max_tools = budget.get("max_tool_calls", 50)
            max_time = budget.get("max_time_seconds", 300)

            reason = None
            if run_details["tool_calls_count"] > max_tools:
                reason = f"Tool call budget exceeded ({run_details['tool_calls_count']} > {max_tools})"
            elif elapsed_time > max_time:
                reason = f"Time budget exceeded ({elapsed_time:.1f}s > {max_time}s)"

            if reason:
                # Mark failed in DB and clean up
                self._cancel_cascade_internal(task_id, f"Budget Exceeded: {reason}")
                self.record_run_end(run_id, "failed", {"reason": reason})
                return {"status": "failed", "should_abort": True, "reason": reason}

            # Update trace in DB
            db_run = self.plan_graph.get_node(run_id)
            trace = db_run.get("executionTrace") or {}
            if trace_update:
                trace.update(trace_update)
            trace["tool_calls_count"] = run_details["tool_calls_count"]
            trace["elapsed_time"] = elapsed_time

            # Save trace back to agent run details
            # Directly call internal _get_connection to update trace to avoid exposing write method details
            with self.plan_graph._get_connection() as conn:
                conn.execute(
                    "UPDATE agent_runs SET execution_trace = ? WHERE id = ?;",
                    (self.plan_graph.json.dumps(trace) if hasattr(self.plan_graph, 'json') else json_dumps(trace), run_id)
                )
                conn.commit()

            return {"status": "running", "should_abort": False, "tool_calls_count": run_details["tool_calls_count"], "elapsed_time": elapsed_time}

    def record_run_end(self, run_id: str, status: str, execution_trace: Optional[Dict[str, Any]] = None) -> None:
        """
        Completes an agent run, freeing concurrency resource.
        """
        with self.lock:
            run_details = self.running_agent_runs.pop(run_id, None)
            if not run_details:
                return

            # Update status in DB
            with self.plan_graph._get_connection() as conn:
                conn.execute(
                    "UPDATE agent_runs SET status = ? WHERE id = ?;",
                    (status, run_id)
                )
                if execution_trace:
                    conn.execute(
                        "UPDATE agent_runs SET execution_trace = ? WHERE id = ?;",
                        (self.plan_graph.json.dumps(execution_trace) if hasattr(self.plan_graph, 'json') else json_dumps(execution_trace), run_id)
                    )
                conn.commit()

            # If failed, we fail the associated task as well
            task_id = run_details["task_id"]
            if status == "failed":
                self.plan_graph.update_task_status(task_id, "failed")
                self.running_tasks.pop(task_id, None)

    def complete_task(self, task_id: str) -> None:
        """
        Succeeds the task and clears it from active concurrency.
        """
        with self.lock:
            self.running_tasks.pop(task_id, None)
            self.plan_graph.update_task_status(task_id, "success")

            # Clean up any remaining runs
            runs_to_remove = [rid for rid, r in self.running_agent_runs.items() if r["task_id"] == task_id]
            for rid in runs_to_remove:
                self.running_agent_runs.pop(rid, None)

    def cancel_task(self, task_id: str) -> None:
        """
        Public cancellation API. Cascade cancels task and all subtasks/delegated runs.
        """
        with self.lock:
            self._cancel_cascade_internal(task_id, "Cancelled by operator")

    def _cancel_cascade_internal(self, task_id: str, reason: str) -> None:
        """
        Recursively cancel task and all its dependencies, blockers, or child tasks.
        """
        # Find all nodes linked from this task using plan view or database edges
        view = self.plan_graph.get_plan_view(task_id)
        nodes_to_cancel = list(view["nodes"].keys())

        # Update all tasks in nodes_to_cancel to status 'cancelled'
        for nid in nodes_to_cancel:
            node = view["nodes"][nid]
            if node["nodeType"] == "task":
                self.plan_graph.update_task_status(nid, "cancelled")
                self.running_tasks.pop(nid, None)

                # Cancel associated running agents
                runs_to_cancel = [rid for rid, r in self.running_agent_runs.items() if r["task_id"] == nid]
                for rid in runs_to_cancel:
                    self.running_agent_runs.pop(rid, None)
                    # Update run status to cancelled
                    with self.plan_graph._get_connection() as conn:
                        conn.execute("UPDATE agent_runs SET status = 'cancelled' WHERE id = ?;", (rid,))
                        conn.commit()

    def get_plan_context_envelope(self, task_id: str) -> Dict[str, Any]:
        """
        Generates the Plan Context Envelope for plan-aware reasoning.
        """
        current_node = self.plan_graph.get_node(task_id)
        if not current_node or current_node["nodeType"] != "task":
            raise ValueError(f"Task '{task_id}' not found.")

        # 1. Find parent task
        parent_task = None
        meta = current_node.get("contextMetadata") or {}
        parent_id = meta.get("delegated_by")
        if parent_id:
            parent_node = self.plan_graph.get_node(parent_id)
            if parent_node and parent_node["nodeType"] == "task":
                parent_task = parent_node

        # 2. Find all tasks in the task tree to build history
        # First, traverse up to the root task
        root_id = task_id
        curr_id = parent_id
        visited = {task_id}
        while curr_id and curr_id not in visited:
            visited.add(curr_id)
            node = self.plan_graph.get_node(curr_id)
            if node and node["nodeType"] == "task":
                root_id = curr_id
                curr_meta = node.get("contextMetadata") or {}
                curr_id = curr_meta.get("delegated_by")
            else:
                break

        # Now, perform BFS to find all tasks in the tree starting from root
        all_tasks = []
        queue = [root_id]
        tree_visited = {root_id}
        while queue:
            curr = queue.pop(0)
            node = self.plan_graph.get_node(curr)
            if node and node["nodeType"] == "task":
                all_tasks.append(node)
                
            with self.plan_graph._get_connection() as conn:
                rows = conn.execute("""
                    SELECT target_id FROM edges 
                    WHERE source_id = ? AND relation_type = 'blocked_by';
                """, (curr,)).fetchall()
                for r in rows:
                    cid = r["target_id"]
                    if cid not in tree_visited:
                        c_node = self.plan_graph.get_node(cid)
                        if c_node and c_node["nodeType"] == "task":
                            tree_visited.add(cid)
                            queue.append(cid)

        # Sort all tasks in the tree by created_at (oldest -> newest)
        all_tasks.sort(key=lambda x: x.get("createdAt", ""))

        # 3. Build TaskHistoryEntry list
        task_history = []
        for t in all_tasks:
            decisions = []
            with self.plan_graph._get_connection() as conn:
                rows = conn.execute("SELECT id FROM decisions WHERE task_id = ?;", (t["id"],)).fetchall()
                for r in rows:
                    dec = self.plan_graph.get_node(r["id"])
                    if dec:
                        decisions.append(dec)
            
            runs = []
            with self.plan_graph._get_connection() as conn:
                rows = conn.execute("SELECT id FROM agent_runs WHERE task_id = ?;", (t["id"],)).fetchall()
                for r in rows:
                    run = self.plan_graph.get_node(r["id"])
                    if run:
                        runs.append(run)

            task_history.append({
                "task": t,
                "decisions": decisions,
                "runs": runs
            })

        # 4. Active Blockers
        active_blockers = self.plan_graph.get_blockers(task_id)

        # 5. Context Artifacts
        descendants = set()
        desc_queue = [task_id]
        while desc_queue:
            curr = desc_queue.pop(0)
            descendants.add(curr)
            with self.plan_graph._get_connection() as conn:
                rows = conn.execute("""
                    SELECT target_id FROM edges 
                    WHERE source_id = ? AND relation_type = 'blocked_by';
                """, (curr,)).fetchall()
                for r in rows:
                    cid = r["target_id"]
                    if cid not in descendants:
                        desc_queue.append(cid)

        sibling_ancestor_tasks = [t for t in all_tasks if t["id"] not in descendants]
        context_artifacts = []
        for t in sibling_ancestor_tasks:
            with self.plan_graph._get_connection() as conn:
                rows = conn.execute("""
                    SELECT target_id FROM edges 
                    WHERE source_id = ? AND relation_type = 'produces';
                """, (t["id"],)).fetchall()
                for r in rows:
                    art = self.plan_graph.get_node(r["target_id"])
                    if art and art["nodeType"] == "artifact":
                        context_artifacts.append(art)

        return {
            "currentTaskId": task_id,
            "parentTask": parent_task,
            "taskHistory": task_history,
            "activeBlockers": active_blockers,
            "contextArtifacts": context_artifacts
        }

# Helper json_dumps for orchestrator scope
def json_dumps(val: Any) -> str:
    import json
    return json.dumps(val)
