from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
import uuid
from src.utils.config import load_config
from src.rag.engine import init_runtime, init_query_engine, answer

cfg = load_config()
_state: dict = {}

# In-memory session store for ChatEditSession
sessions = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def broadcast_to_session(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

manager = ConnectionManager()

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

# Add CORS Middleware to resolve ERR_CONNECTION_REFUSED / preflight issues
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

# --- WebSocket Streaming ---
@app.websocket("/chat-edit-session/stream")
async def websocket_endpoint(websocket: WebSocket, sessionId: str):
    await manager.connect(sessionId, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "subscribe":
                # client subscribed
                pass
    except WebSocketDisconnect:
        manager.disconnect(sessionId, websocket)
    except Exception:
        manager.disconnect(sessionId, websocket)

# --- ChatEditSession REST Endpoints ---
class TurnRequest(BaseModel):
    sessionId: str
    instruction: str

class RollbackRequest(BaseModel):
    sessionId: str

@app.post("/api/chat-edit-session/turn")
async def chat_edit_session_turn(req: TurnRequest):
    session_id = req.sessionId
    instruction = req.instruction.lower()
    
    if session_id not in sessions:
        sessions[session_id] = {
            "turnsUsed": 0,
            "history": []
        }
    
    sessions[session_id]["turnsUsed"] += 1
    turns_used = sessions[session_id]["turnsUsed"]
    
    # Determine mock edit operation based on instruction
    op_type = "ColorChange"
    selector = ".hero"
    value = "#001a33"
    
    if "color" in instruction or "background" in instruction:
        op_type = "ColorChange"
        selector = ".hero" if "hero" in instruction else "body"
        value = "#1e293b" if "dark" in instruction else "#f59e0b"
    elif "font" in instruction or "size" in instruction or "typography" in instruction:
        op_type = "TypographyUpdate"
        selector = "h1" if "title" in instruction else "p"
        value = "3rem" if "large" in instruction else "1.125rem"
    elif "layout" in instruction or "margin" in instruction or "display" in instruction:
        op_type = "LayoutShift"
        selector = ".hero"
        value = "flex"
    elif "delete" in instruction or "remove" in instruction:
        op_type = "DeleteNode"
        selector = "p"
    elif "insert" in instruction or "add" in instruction:
        op_type = "InsertNode"
        selector = ".hero"
        value = "<span>New Subtitle</span>"
    
    op = {
        "id": f"op-{uuid.uuid4().hex[:8]}",
        "type": op_type,
        "selector": selector,
        "value": value
    }
    
    patch = {
        "id": f"patch-{uuid.uuid4().hex[:8]}",
        "ops": [op],
        "rawPatch": f"/* DOMPatch applied to {selector} */",
        "cacheHit": turns_used % 3 == 0,
        "appliedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    # Save to session history
    sessions[session_id]["history"].append({
        "user_msg": req.instruction,
        "patch": patch
    })
    
    # Broadcast to websocket clients
    # Cache event
    await manager.broadcast_to_session(session_id, {
        "type": "cache-event",
        "cacheHit": patch["cacheHit"]
    })
    
    # User message
    await manager.broadcast_to_session(session_id, {
        "type": "turn",
        "turn": {
            "id": f"msg-usr-{uuid.uuid4().hex[:8]}",
            "role": "user",
            "text": req.instruction,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
    })
    
    # Agent response message
    await manager.broadcast_to_session(session_id, {
        "type": "turn",
        "turn": {
            "id": f"msg-agt-{uuid.uuid4().hex[:8]}",
            "role": "agent",
            "text": f"Applied {op_type} patch on selector '{selector}' with value '{value}'.",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
    })
    
    # Patch event
    await manager.broadcast_to_session(session_id, {
        "type": "patch",
        "patch": patch
    })
    
    # Preview refresh event
    preview_url = f"http://localhost:5173/preview?session={session_id}&t={turns_used}"
    await manager.broadcast_to_session(session_id, {
        "type": "preview-refresh",
        "previewUrl": preview_url,
        "latencyMs": 145
    })
    
    return {
        "turnsUsed": turns_used,
        "previewUrl": preview_url
    }

@app.post("/api/chat-edit-session/rollback")
async def chat_edit_session_rollback(req: RollbackRequest):
    session_id = req.sessionId
    if session_id in sessions and sessions[session_id]["history"]:
        sessions[session_id]["history"].pop()
        sessions[session_id]["turnsUsed"] = max(0, sessions[session_id]["turnsUsed"] - 1)
        
    turns_used = sessions[session_id]["turnsUsed"] if session_id in sessions else 0
    preview_url = f"http://localhost:5173/preview?session={session_id}&t={turns_used}"
    return {
        "previewUrl": preview_url
    }
