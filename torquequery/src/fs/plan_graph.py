import sqlite3
import json
import uuid
import time
import os
from typing import Dict, List, Set, Any, Optional
from contextlib import contextmanager

class PlanGraphStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        # Ensure directories exist
        db_dir = os.path.dirname(os.path.abspath(db_path))
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        self._init_db()

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_db(self):
        with self._get_connection() as conn:
            # 1. Identity table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    node_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                );
            """)
            # 2. Tasks details
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT,
                    context_metadata TEXT
                );
            """)
            # 3. Artifacts details
            conn.execute("""
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
                    path TEXT NOT NULL,
                    type TEXT NOT NULL,
                    checksum TEXT,
                    created_at TEXT NOT NULL
                );
            """)
            # 4. Decisions details
            conn.execute("""
                CREATE TABLE IF NOT EXISTS decisions (
                    id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    rationale TEXT,
                    options_considered TEXT,
                    chosen_option TEXT,
                    created_at TEXT NOT NULL
                );
            """)
            # 5. Agent runs details
            conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    agent_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    execution_trace TEXT,
                    created_at TEXT NOT NULL
                );
            """)
            # 6. Generic edges
            conn.execute("""
                CREATE TABLE IF NOT EXISTS edges (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    relation_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(source_id, target_id, relation_type)
                );
            """)
            
            # Indexes
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_path ON artifacts(path);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);")
            conn.commit()

    def _now(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def _uuid(self) -> str:
        return str(uuid.uuid4())

    def _row_to_dict(self, row: sqlite3.Row, node_type: str) -> Dict[str, Any]:
        d = dict(row)
        # Handle parsed JSON columns
        if "context_metadata" in d and d["context_metadata"]:
            d["contextMetadata"] = json.loads(d["context_metadata"])
            del d["context_metadata"]
        if "options_considered" in d and d["options_considered"]:
            d["optionsConsidered"] = json.loads(d["options_considered"])
            del d["options_considered"]
        if "execution_trace" in d and d["execution_trace"]:
            d["executionTrace"] = json.loads(d["execution_trace"])
            del d["execution_trace"]
            
        # Map camelCase for SDK consistency
        if "node_type" in d:
            d["nodeType"] = d["node_type"]
            del d["node_type"]
        if "created_at" in d:
            d["createdAt"] = d["created_at"]
            del d["created_at"]
        if "updated_at" in d:
            d["updatedAt"] = d["updated_at"]
            del d["updated_at"]
        if "task_id" in d:
            d["taskId"] = d["task_id"]
            del d["task_id"]
        if "chosen_option" in d:
            d["chosenOption"] = d["chosen_option"]
            del d["chosen_option"]
        if "agent_type" in d:
            d["agentType"] = d["agent_type"]
            del d["agent_type"]
            
        d["nodeType"] = node_type
        return d

    # --- Write Path Operations ---

    def create_task(self, title: str, description: Optional[str] = None, 
                    status: str = "pending", context_metadata: Optional[Dict[str, Any]] = None, 
                    task_id: Optional[str] = None) -> Dict[str, Any]:
        node_id = task_id or self._uuid()
        now = self._now()
        meta_json = json.dumps(context_metadata or {})
        
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO nodes (id, node_type, created_at) VALUES (?, ?, ?);",
                (node_id, "task", now)
            )
            conn.execute(
                "INSERT INTO tasks (id, title, description, status, created_at, context_metadata) VALUES (?, ?, ?, ?, ?, ?);",
                (node_id, title, description, status, now, meta_json)
            )
            conn.commit()
            
        return {
            "id": node_id,
            "nodeType": "task",
            "title": title,
            "description": description,
            "status": status,
            "contextMetadata": context_metadata or {},
            "createdAt": now,
            "updatedAt": None
        }

    def update_task_status(self, task_id: str, status: str) -> None:
        now = self._now()
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?;",
                (status, now, task_id)
            )
            conn.execute(
                "UPDATE nodes SET updated_at = ? WHERE id = ?;",
                (now, task_id)
            )
            conn.commit()

    def record_artifact(self, task_id: str, path: str, type: str, 
                        checksum: Optional[str] = None, artifact_id: Optional[str] = None) -> Dict[str, Any]:
        node_id = artifact_id or self._uuid()
        now = self._now()
        
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO nodes (id, node_type, created_at) VALUES (?, ?, ?);",
                (node_id, "artifact", now)
            )
            conn.execute(
                "INSERT INTO artifacts (id, path, type, checksum, created_at) VALUES (?, ?, ?, ?, ?);",
                (node_id, path, type, checksum, now)
            )
            # Link task -[produces]-> artifact
            conn.execute(
                "INSERT OR IGNORE INTO edges (source_id, target_id, relation_type, created_at) VALUES (?, ?, ?, ?);",
                (task_id, node_id, "produces", now)
            )
            conn.commit()
            
        return {
            "id": node_id,
            "nodeType": "artifact",
            "path": path,
            "type": type,
            "checksum": checksum,
            "createdAt": now
        }

    def record_decision(self, task_id: str, rationale: Optional[str] = None, 
                        options_considered: Optional[Dict[str, Any]] = None, 
                        chosen_option: Optional[str] = None, decision_id: Optional[str] = None) -> Dict[str, Any]:
        node_id = decision_id or self._uuid()
        now = self._now()
        options_json = json.dumps(options_considered or {})
        
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO nodes (id, node_type, created_at) VALUES (?, ?, ?);",
                (node_id, "decision", now)
            )
            conn.execute(
                "INSERT INTO decisions (id, task_id, rationale, options_considered, chosen_option, created_at) VALUES (?, ?, ?, ?, ?, ?);",
                (node_id, task_id, rationale, options_json, chosen_option, now)
            )
            # Link task -[decided_by]-> decision
            conn.execute(
                "INSERT OR IGNORE INTO edges (source_id, target_id, relation_type, created_at) VALUES (?, ?, ?, ?);",
                (task_id, node_id, "decided_by", now)
            )
            conn.commit()
            
        return {
            "id": node_id,
            "nodeType": "decision",
            "taskId": task_id,
            "rationale": rationale,
            "optionsConsidered": options_considered or {},
            "chosenOption": chosen_option,
            "createdAt": now
        }

    def record_agent_run(self, task_id: str, agent_type: str, status: str, 
                         execution_trace: Optional[Dict[str, Any]] = None, 
                         run_id: Optional[str] = None) -> Dict[str, Any]:
        node_id = run_id or self._uuid()
        now = self._now()
        trace_json = json.dumps(execution_trace or {})
        
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO nodes (id, node_type, created_at) VALUES (?, ?, ?);",
                (node_id, "agent_run", now)
            )
            conn.execute(
                "INSERT INTO agent_runs (id, task_id, agent_type, status, execution_trace, created_at) VALUES (?, ?, ?, ?, ?, ?);",
                (node_id, task_id, agent_type, status, trace_json, now)
            )
            # Link run -[decided_by]-> run (just to represent run linked to task node)
            conn.execute(
                "INSERT OR IGNORE INTO edges (source_id, target_id, relation_type, created_at) VALUES (?, ?, ?, ?);",
                (task_id, node_id, "decided_by", now)
            )
            conn.commit()
            
        return {
            "id": node_id,
            "nodeType": "agent_run",
            "taskId": task_id,
            "agentType": agent_type,
            "status": status,
            "executionTrace": execution_trace or {},
            "createdAt": now
        }

    def link_nodes(self, source_id: str, target_id: str, relation_type: str) -> None:
        now = self._now()
        with self._get_connection() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO edges (source_id, target_id, relation_type, created_at) VALUES (?, ?, ?, ?);",
                (source_id, target_id, relation_type, now)
            )
            conn.commit()

    def delete_node(self, node_id: str) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM nodes WHERE id = ?;", (node_id,))
            conn.commit()

    # --- Read Path Operations ---

    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            node_row = conn.execute("SELECT node_type FROM nodes WHERE id = ?;", (node_id,)).fetchone()
            if not node_row:
                return None
                
            node_type = node_row["node_type"]
            if node_type == "task":
                row = conn.execute("SELECT * FROM tasks WHERE id = ?;", (node_id,)).fetchone()
            elif node_type == "artifact":
                row = conn.execute("SELECT * FROM artifacts WHERE id = ?;", (node_id,)).fetchone()
            elif node_type == "decision":
                row = conn.execute("SELECT * FROM decisions WHERE id = ?;", (node_id,)).fetchone()
            elif node_type == "agent_run":
                row = conn.execute("SELECT * FROM agent_runs WHERE id = ?;", (node_id,)).fetchone()
            else:
                return None
                
            if row:
                return self._row_to_dict(row, node_type)
        return None

    def get_edges(self, node_id: str) -> List[Dict[str, Any]]:
        edges = []
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM edges WHERE source_id = ? OR target_id = ?;",
                (node_id, node_id)
            ).fetchall()
            for r in rows:
                edges.append({
                    "id": r["id"],
                    "sourceId": r["source_id"],
                    "targetId": r["target_id"],
                    "relationType": r["relation_type"],
                    "createdAt": r["created_at"]
                })
        return edges

    def get_children(self, node_id: str, relation_type: Optional[str] = None) -> List[Dict[str, Any]]:
        children = []
        with self._get_connection() as conn:
            if relation_type:
                rows = conn.execute(
                    "SELECT target_id FROM edges WHERE source_id = ? AND relation_type = ?;",
                    (node_id, relation_type)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT target_id FROM edges WHERE source_id = ?;",
                    (node_id,)
                ).fetchall()
                
            for r in rows:
                child = self.get_node(r["target_id"])
                if child:
                    children.append(child)
        return children

    def get_parents(self, node_id: str, relation_type: Optional[str] = None) -> List[Dict[str, Any]]:
        parents = []
        with self._get_connection() as conn:
            if relation_type:
                rows = conn.execute(
                    "SELECT source_id FROM edges WHERE target_id = ? AND relation_type = ?;",
                    (node_id, relation_type)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT source_id FROM edges WHERE target_id = ?;",
                    (node_id,)
                ).fetchall()
                
            for r in rows:
                parent = self.get_node(r["source_id"])
                if parent:
                    parents.append(parent)
        return parents

    # --- Recursive CTE / Traversal Operations ---

    def get_dependencies(self, task_id: str) -> List[Dict[str, Any]]:
        """
        Recursively get all dependencies of a task.
        """
        deps = []
        with self._get_connection() as conn:
            rows = conn.execute("""
                WITH RECURSIVE deps(task_id) AS (
                    SELECT ?
                    UNION
                    SELECT e.target_id
                    FROM edges e
                    JOIN deps d ON e.source_id = d.task_id
                    WHERE e.relation_type = 'depends_on'
                )
                SELECT task_id FROM deps WHERE task_id != ?;
            """, (task_id, task_id)).fetchall()
            
            for r in rows:
                node = self.get_node(r["task_id"])
                if node:
                    deps.append(node)
        return deps

    def get_blockers(self, task_id: str) -> List[Dict[str, Any]]:
        """
        Recursively get all blockers of a task.
        """
        blockers = []
        with self._get_connection() as conn:
            rows = conn.execute("""
                WITH RECURSIVE blockers(task_id) AS (
                    SELECT ?
                    UNION
                    SELECT e.target_id
                    FROM edges e
                    JOIN blockers b ON e.source_id = b.task_id
                    WHERE e.relation_type = 'blocked_by'
                )
                SELECT task_id FROM blockers WHERE task_id != ?;
            """, (task_id, task_id)).fetchall()
            
            for r in rows:
                node = self.get_node(r["task_id"])
                if node:
                    blockers.append(node)
        return blockers

    def search_tasks(self, query: str) -> List[Dict[str, Any]]:
        tasks = []
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ?;",
                (f"%{query}%", f"%{query}%")
            ).fetchall()
            for r in rows:
                tasks.append(self._row_to_dict(r, "task"))
        return tasks

    def get_plan_view(self, task_id: str) -> Dict[str, Any]:
        """
        Builds a compact sub-graph representation containing:
        - The target task and all of its recursive dependencies and blockers.
        - Sibling and child tasks in the tree.
        - Decisions, runs, and artifacts connected to any of the discovered tasks.
        """
        # 1. Discover all task nodes in the task tree
        discovered_task_ids: Set[str] = {task_id}
        queue = [task_id]
        
        # Traverse both directions (parent, child, blocker, depends) to capture the subgraph
        with self._get_connection() as conn:
            while queue:
                curr = queue.pop(0)
                # Find all task neighbors linked via task-to-task relationships
                rows = conn.execute("""
                    SELECT source_id, target_id FROM edges 
                    WHERE (source_id = ? OR target_id = ?) 
                      AND relation_type IN ('depends_on', 'blocked_by', 'refines');
                """, (curr, curr)).fetchall()
                
                for r in rows:
                    source, target = r["source_id"], r["target_id"]
                    # We check if they are tasks
                    for nid in (source, target):
                        if nid not in discovered_task_ids:
                            # Verify node type
                            n_type = conn.execute("SELECT node_type FROM nodes WHERE id = ?;", (nid,)).fetchone()
                            if n_type and n_type["node_type"] == "task":
                                discovered_task_ids.add(nid)
                                queue.append(nid)

        # 2. Collect all decisions, runs, and artifacts connected to these tasks
        all_node_ids = set(discovered_task_ids)
        edges: List[Dict[str, Any]] = []
        
        with self._get_connection() as conn:
            for tid in discovered_task_ids:
                # Find all outgoing and incoming edges for this task
                rows = conn.execute("SELECT * FROM edges WHERE source_id = ? OR target_id = ?;", (tid, tid)).fetchall()
                for r in rows:
                    edge_dict = {
                        "id": r["id"],
                        "sourceId": r["source_id"],
                        "targetId": r["target_id"],
                        "relationType": r["relation_type"],
                        "createdAt": r["created_at"]
                    }
                    if edge_dict not in edges:
                        edges.append(edge_dict)
                    all_node_ids.add(r["source_id"])
                    all_node_ids.add(r["target_id"])

        # 3. Load all nodes
        nodes: Dict[str, Dict[str, Any]] = {}
        for nid in all_node_ids:
            node = self.get_node(nid)
            if node:
                nodes[nid] = node

        return {
            "nodes": nodes,
            "edges": edges
        }
