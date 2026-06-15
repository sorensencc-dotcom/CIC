from fastapi import FastAPI
from pydantic import BaseModel
from src.utils.config import load_config
from src.rag.engine import init_runtime, init_query_engine, answer

cfg = load_config()
init_runtime(cfg)
qe = init_query_engine(cfg)

app = FastAPI()

class Query(BaseModel):
    question: str
    taskLabels: list[str] | None = None

@app.post("/query")
def query(req: Query):
    return answer(cfg, qe, req.question, req.taskLabels or [])

@app.post("/ingest")
def ingest():
    from scripts.ingest import main as ingest_main
    ingest_main()
    return {"status": "ok"}

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "version": "0.1.0-alpha",
        "models": cfg["models"],
        "config": {
            "chunkSize": cfg["chunking"]["chunk_size"],
            "chunkOverlap": cfg["chunking"]["chunk_overlap"],
            "topK": cfg["retrieval"]["top_k"],
            "maxContextTokens": cfg["retrieval"]["max_context_tokens"],
        },
    }
