import os
import json
import time
from typing import Dict, List, Any, Optional

METRICS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage", "metrics"))
METRICS_FILE = os.path.join(METRICS_DIR, "metrics.jsonl")

def log_metric(operation: str, duration_ms: float, metadata: Optional[Dict[str, Any]] = None) -> None:
    """
    Append a structured metric entry to the metrics.jsonl file.
    """
    try:
        if not os.path.exists(METRICS_DIR):
            os.makedirs(METRICS_DIR, exist_ok=True)
            
        entry = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "operation": operation,
            "durationMs": int(duration_ms),
            "metadata": metadata or {}
        }
        
        with open(METRICS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"Warning: Failed to log metric: {str(e)}")

def get_metrics_summary() -> Dict[str, Any]:
    """
    Read the metrics.jsonl file and aggregate metrics:
    - Total operations
    - Hits per operation type
    - Latency statistics (average, p50, p90, p99)
    - Metadata summaries (e.g. search hits, RRF scores, spec tool hits)
    """
    if not os.path.exists(METRICS_FILE):
        return {
            "totalOperations": 0,
            "hits": {},
            "latencyStats": {},
            "message": "No metrics recorded yet."
        }
        
    ops_count = 0
    hits: Dict[str, int] = {}
    latencies: Dict[str, List[int]] = {}
    metadata_summary: Dict[str, Any] = {
        "searchModes": {},
        "totalCandidateChunks": 0,
        "totalMatches": 0
    }
    
    try:
        with open(METRICS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                    
                ops_count += 1
                op = entry["operation"]
                duration = entry["durationMs"]
                
                # Hits counter
                hits[op] = hits.get(op, 0) + 1
                
                # Latency tracker
                if op not in latencies:
                    latencies[op] = []
                latencies[op].append(duration)
                
                # Extract search/find meta
                meta = entry.get("metadata", {})
                if op == "/api/fs/search":
                    mode = meta.get("mode", "unknown")
                    metadata_summary["searchModes"][mode] = metadata_summary["searchModes"].get(mode, 0) + 1
                    metadata_summary["totalCandidateChunks"] += meta.get("candidateChunks", 0)
                    metadata_summary["totalMatches"] += meta.get("matchesCount", 0)
        
        # Calculate latency stats
        stats = {}
        for op, durs in latencies.items():
            if not durs:
                continue
            sorted_durs = sorted(durs)
            count = len(sorted_durs)
            avg = sum(sorted_durs) / count
            
            p50 = sorted_durs[int(count * 0.5)]
            p90 = sorted_durs[int(count * 0.9)] if count >= 10 else sorted_durs[-1]
            p99 = sorted_durs[int(count * 0.99)] if count >= 100 else sorted_durs[-1]
            
            stats[op] = {
                "count": count,
                "averageMs": round(avg, 2),
                "p50Ms": p50,
                "p90Ms": p90,
                "p99Ms": p99
            }
            
        return {
            "totalOperations": ops_count,
            "hits": hits,
            "latencyStats": stats,
            "searchSummary": metadata_summary
        }
    except Exception as e:
        return {"error": f"Failed to compute summary: {str(e)}"}
