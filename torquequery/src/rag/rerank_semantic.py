_reranker = None

def init_reranker(model_name: str):
    global _reranker
    from sentence_transformers import CrossEncoder
    _reranker = CrossEncoder(model_name)

def rerank_semantic(question: str, source_nodes, top_k: int):
    import math
    if not source_nodes:
        return []
        
    pairs = [(question, sn.node.text) for sn in source_nodes]
    scores = _reranker.predict(pairs)
    
    def sigmoid(x):
        return 1.0 / (1.0 + math.exp(-x))
        
    for sn, score in zip(source_nodes, scores):
        sn.score = float(sigmoid(score))
        
    ranked = sorted(source_nodes, key=lambda x: x.score or 0.0, reverse=True)
    return ranked[:top_k]
