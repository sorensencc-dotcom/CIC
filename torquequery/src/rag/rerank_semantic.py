_reranker = None

def init_reranker(model_name: str):
    global _reranker
    from sentence_transformers import CrossEncoder
    _reranker = CrossEncoder(model_name)

def rerank_semantic(question: str, source_nodes, top_k: int):
    pairs = [(question, sn.node.text) for sn in source_nodes]
    scores = _reranker.predict(pairs)
    ranked = sorted(zip(source_nodes, scores), key=lambda x: x[1], reverse=True)
    return [sn for sn, _ in ranked[:top_k]]
