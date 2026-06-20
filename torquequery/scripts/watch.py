import sys
import os
import time
from pathlib import Path

# Ensure project root is in the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.utils.config import load_config
from scripts.ingest import main as run_ingestion

def get_files_state(docs_root: Path, mkdocs_yml: Path):
    state = {}
    
    # Track docs_root files
    if docs_root.exists():
        for root, _, files in os.walk(docs_root):
            for file in files:
                if file.endswith('.md'):
                    path = Path(root) / file
                    try:
                        state[str(path)] = path.stat().st_mtime
                    except OSError:
                        pass
                        
    # Track mkdocs.yml
    if mkdocs_yml.exists():
        try:
            state[str(mkdocs_yml)] = mkdocs_yml.stat().st_mtime
        except OSError:
            pass
            
    return state

def main():
    cfg = load_config()
    docs_root = Path(cfg["paths"]["docs_root"])
    mkdocs_yml = Path(cfg["paths"]["mkdocs_yml"])
    
    # Resolve relative paths relative to the current working directory
    resolved_docs_root = docs_root.resolve()
    resolved_mkdocs_yml = mkdocs_yml.resolve()
    
    print(f"[*] Starting file watcher on docs: {resolved_docs_root}")
    print(f"[*] Watching config: {resolved_mkdocs_yml}")
    
    last_state = get_files_state(resolved_docs_root, resolved_mkdocs_yml)
    print(f"[*] Tracking {len(last_state)} documentation files.")
    
    debounce_time = 1.0  # 1 second debounce
    last_change_time = 0.0
    pending_ingest = False
    
    try:
        while True:
            time.sleep(1.0)
            current_state = get_files_state(resolved_docs_root, resolved_mkdocs_yml)
            
            # Detect changes (additions, modifications, deletions)
            changed = False
            
            if set(current_state.keys()) != set(last_state.keys()):
                changed = True
            else:
                for path, mtime in current_state.items():
                    if last_state.get(path) != mtime:
                        changed = True
                        break
            
            if changed:
                print("[!] Change detected in documentation files...")
                last_change_time = time.time()
                pending_ingest = True
                last_state = current_state
                
            # If there's a pending ingestion and we have debounced, run it
            if pending_ingest and (time.time() - last_change_time >= debounce_time):
                print("[*] Running auto-ingestion...")
                try:
                    run_ingestion()
                    print("[+] Ingestion complete.")
                except Exception as e:
                    print(f"[-] Ingestion failed: {e}")
                pending_ingest = False
                
    except KeyboardInterrupt:
        print("\n[*] File watcher stopped.")

if __name__ == "__main__":
    main()
