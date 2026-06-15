def tag_overlap_score(node_tags, task_labels):
    if not node_tags or not task_labels:
        return 0.0
    ns = set(t.lower() for t in node_tags)
    ts = set(l.lower() for l in task_labels)
    overlap = ns & ts
    return float(len(overlap)) / float(len(ts) or 1)

def tag_aware_rerank(source_nodes, task_labels, base_weight=1.0, tag_boost=0.3):
    ranked = []
    for sn in source_nodes:
        base = sn.score or 0.0
        tags_raw = sn.node.metadata.get("tags", "")
        tags = [t for t in tags_raw.split(",") if t] if isinstance(tags_raw, str) else tags_raw
        ov = tag_overlap_score(tags, task_labels)
        final = base * (base_weight + tag_boost * ov)
        ranked.append((sn, final))
    ranked.sort(key=lambda x: x[1], reverse=True)
    return [sn for sn, _ in ranked]
