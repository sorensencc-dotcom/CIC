from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from src.utils.config import load_config
from src.rag.engine import init_runtime, init_query_engine, answer

cfg = load_config()
_state: dict = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    def _init():
        init_runtime(cfg)
        _state["qe"] = init_query_engine(cfg)

    loop = asyncio.get_event_loop()
    # Fire init in background thread — don't await so port binds immediately
    _state["_init_task"] = loop.run_in_executor(None, _init)
    yield
    # Clean up on shutdown
    if not _state["_init_task"].done():
        _state["_init_task"].cancel()
    _state.clear()

app = FastAPI(lifespan=lifespan)

class Query(BaseModel):
    question: str
    taskLabels: list[str] | None = None

@app.post("/query")
def query(req: Query):
    qe = _state.get("qe")
    if qe is None:
        raise HTTPException(status_code=503, detail="Service initializing, retry in a moment")
    return answer(cfg, qe, req.question, req.taskLabels or [])

@app.post("/ingest")
def ingest():
    from scripts.ingest import main as ingest_main
    ingest_main()
    return {"status": "ok"}

@app.get("/health")
def health():
    return {
        "status": "healthy" if _state.get("qe") else "initializing",
        "version": "0.1.0-alpha",
        "models": cfg["models"],
        "config": {
            "chunkSize": cfg["chunking"]["chunk_size"],
            "chunkOverlap": cfg["chunking"]["chunk_overlap"],
            "topK": cfg["retrieval"]["top_k"],
            "maxContextTokens": cfg["retrieval"]["max_context_tokens"],
        },
    }
