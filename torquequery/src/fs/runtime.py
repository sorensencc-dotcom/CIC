import json
import os
import time
import threading
from typing import Dict, List, Set, Any, Optional
from .rbac import prune_path_tree, build_directory_structure

class PathTreeState:
    def __init__(self, full_tree: Dict[str, Any]):
        self.full_tree = full_tree

class PathTreeRuntime:
    def __init__(self, workspace_root: str, chroma_dir: str):
        self.workspace_root = workspace_root
        self.chroma_dir = chroma_dir
        self._state: Optional[PathTreeState] = None
        self._lock = threading.Lock()

    def get_full_tree(self) -> Dict[str, Any]:
        with self._lock:
            if self._state is None:
                # Lazy load on first request
                self.rebuild()
            return self._state.full_tree if self._state else {}

    def get_pruned_fs(self, user_groups: List[str], is_admin: bool = False) -> tuple[Set[str], Dict[str, List[Dict[str, Any]]], Dict[str, Any]]:
        """
        Returns a pruned (RBAC filtered) View of the filesystem:
        - path_set: Set of visible files
        - dir_map: Directory traversal lookup
        - meta_map: File metadata mapping
        """
        full_tree = self.get_full_tree()
        pruned_meta_map = prune_path_tree(full_tree, user_groups, is_admin)
        path_set, dir_map = build_directory_structure(pruned_meta_map)
        return path_set, dir_map, pruned_meta_map

    def rebuild(self) -> int:
        """
        Synchronously rebuild the path tree state. Atomic double-buffered swap.
        Returns duration of the rebuild in milliseconds.
        """
        start_time = time.time()
        
        # 1. Load config-defined virtual paths
        config_path = os.path.join(self.workspace_root, "torquequery", "config", "virtual_paths.json")
        virtual_paths = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    virtual_paths = json.load(f)
            except Exception as e:
                print(f"Error loading virtual_paths.json: {str(e)}")
                
        # 2. Load indexed document paths from ChromaDB
        indexed_paths = self._query_chroma_paths()
        
        # 3. Merge: virtual paths overwrite or augment indexed paths
        merged_tree = {}
        # Add indexed paths first
        for path, meta in indexed_paths.items():
            merged_tree[path] = meta
        # Add/overwrite with virtual paths
        for path, meta in virtual_paths.items():
            merged_tree[path] = meta
            
        # 4. Atomic swap
        new_state = PathTreeState(merged_tree)
        with self._lock:
            self._state = new_state
            
        duration_ms = int((time.time() - start_time) * 1000)
        return duration_ms

    def _query_chroma_paths(self) -> Dict[str, Any]:
        """
        Query ChromaDB to retrieve all indexed page paths and tags.
        """
        import chromadb
        paths = {}
        try:
            # Check if directory exists
            if not os.path.exists(self.chroma_dir):
                return {}
                
            client = chromadb.PersistentClient(path=self.chroma_dir)
            # Check if collection exists
            collections = [col.name for col in client.list_collections()]
            if "torquequery" not in collections:
                return {}
                
            collection = client.get_collection("torquequery")
            # Retrieve all stored metadatas
            results = collection.get(include=["metadatas"])
            
            if results and results.get("metadatas"):
                for meta in results["metadatas"]:
                    if not meta or "file_path" not in meta:
                        continue
                        
                    file_path = meta["file_path"]
                    # Normalize Windows paths
                    normalized_path = file_path.replace("\\", "/")
                    
                    if normalized_path not in paths:
                        tags_raw = meta.get("tags", "")
                        tags = [t.strip() for t in tags_raw.split(",") if t.strip()] if isinstance(tags_raw, str) else []
                        
                        paths[normalized_path] = {
                            "type": "page",
                            "source": meta.get("source", "mintlify"),
                            "isPublic": True,
                            "groups": [],
                            "tags": tags,
                            "lazy": False
                        }
        except Exception as e:
            print(f"Warning: Failed to fetch Chroma paths: {str(e)}")
            
        return paths
