from typing import Dict, List, Set, Any

def prune_path_tree(full_tree: Dict[str, Any], user_groups: List[str], is_admin: bool) -> Dict[str, Any]:
    """
    Filter the path tree based on user group membership.
    If is_admin is True, all paths are visible.
    Otherwise, paths are visible if they are public or if there's an overlap
    between path groups and user_groups.
    """
    user_groups_set = {g.lower() for g in user_groups}
    pruned = {}
    
    for path, meta in full_tree.items():
        is_public = meta.get("isPublic", True)
        if is_public or is_admin:
            pruned[path] = meta
            continue
            
        path_groups = meta.get("groups", [])
        path_groups_set = {g.lower() for g in path_groups}
        
        # Intersection check
        if user_groups_set.intersection(path_groups_set):
            pruned[path] = meta
            
    return pruned

def build_directory_structure(pruned_tree: Dict[str, Any]) -> tuple[Set[str], Dict[str, List[Dict[str, Any]]]]:
    """
    From a flat map of file paths to metadata:
    - Build a set of all valid, visible file/page paths.
    - Reconstruct virtual directories (DirMap) with directory child listings.
    
    Returns:
        path_set: Set of visible files
        dir_map: Map of dir_path -> list of children objects (name, fullPath, type, lazy)
    """
    path_set = set(pruned_tree.keys())
    dir_map: Dict[str, List[Dict[str, Any]]] = {}
    
    # Track directories we've already initialized
    for path, meta in pruned_tree.items():
        parts = path.split("/")
        
        # For each segment of the path, register it as a child of its parent directory
        for i in range(len(parts)):
            # Determine parent path
            parent = "/".join(parts[:i])
            name = parts[i]
            full_path = "/".join(parts[:i+1])
            
            if parent not in dir_map:
                dir_map[parent] = []
                
            # If it's the last part, it's a file
            if i == len(parts) - 1:
                # Avoid duplicates
                if not any(item["fullPath"] == full_path for item in dir_map[parent]):
                    dir_map[parent].append({
                        "name": name,
                        "fullPath": full_path,
                        "type": meta.get("type", "page"),
                        "lazy": meta.get("lazy", False)
                    })
            else:
                # It's a directory
                if not any(item["fullPath"] == full_path for item in dir_map[parent]):
                    dir_map[parent].append({
                        "name": name,
                        "fullPath": full_path,
                        "type": "directory",  # Implicit type for folders
                        "lazy": False
                    })
                    
    return path_set, dir_map
