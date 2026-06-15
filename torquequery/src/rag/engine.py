from llama_index.core import load_index_from_storage, Settings
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding
from src.ingestion.indexer import build_storage
from src.rag.prompts import build_prompt
from src.rag.rerank_semantic import init_reranker, rerank_semantic
from src.rag.rerank_tags import tag_aware_rerank
from src.rag.context import pack_context

def init_runtime(cfg):
    Settings.llm = Ollama(model=cfg["models"]["llm"])
    Settings.embed_model = OllamaEmbedding(model=cfg["models"]["embedding"])
    init_reranker(cfg["models"]["reranker"])

def init_query_engine(cfg):
    storage = build_storage(cfg["paths"]["chroma_dir"])
    index = load_index_from_storage(storage)
    return index.as_query_engine(similarity_top_k=cfg["retrieval"]["top_k"], response_mode="compact")

def format_json_answer(answer_text, nodes):
    return {
        "answer": answer_text,
        "sources": [
            {
                "file": n.node.metadata.get("file_path", ""),
                "section": n.node.metadata.get("mkdocs_path", ""),
                "tags": n.node.metadata.get("tags", []),
                "score": float(n.score or 0.0),
            }
            for n in nodes
        ],
        "confidence": 0.0,
        "not_in_docs": False,
    }

def answer(cfg, query_engine, question: str, task_labels=None):
    resp = query_engine.query(question)
    nodes = resp.source_nodes

    nodes = rerank_semantic(question, nodes, cfg["retrieval"]["top_k"])
    if task_labels:
        nodes = tag_aware_rerank(nodes, task_labels)

    context = pack_context(nodes, cfg["retrieval"]["max_context_tokens"])
    prompt = build_prompt(context, question)
    llm = Settings.llm
    llm_resp = llm.complete(prompt)
    return format_json_answer(str(llm_resp), nodes)
