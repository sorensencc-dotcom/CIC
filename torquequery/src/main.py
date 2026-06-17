from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
import uuid
import os
from pathlib import Path
from src.utils.config import load_config
from src.rag.engine import init_runtime, init_query_engine, answer
from src.fs.runtime import PathTreeRuntime
from src.fs.planner import QueryPlanner
from src.fs.resolvers import DefaultLazyResolver

cfg = load_config()
_state: dict = {}

# Initialize Virtual FS components
workspace_root = str(Path(__file__).parent.parent.parent)
chroma_dir = cfg["paths"]["chroma_dir"]

fs_runtime = PathTreeRuntime(workspace_root, chroma_dir)
query_planner = QueryPlanner(chroma_dir)
lazy_resolver = DefaultLazyResolver(workspace_root)

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
            failed_connections = []
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    failed_connections.append(connection)
            for connection in failed_connections:
                self.disconnect(session_id, connection)

manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    async def _init():
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, init_runtime, cfg)
            _state["qe"] = await loop.run_in_executor(None, init_query_engine, cfg)
            print("INFO:     TorqueQuery engine initialization complete.", flush=True)
        except Exception as e:
            import traceback
            print("ERROR:    TorqueQuery engine initialization failed!", flush=True)
            traceback.print_exc()
            _state["init_error"] = str(e)

    # Fire init in background task — don't await so port binds immediately
    _state["_init_task"] = asyncio.create_task(_init())
    yield
    # Clean up on shutdown
    if not _state["_init_task"].done():
        _state["_init_task"].cancel()
        try:
            await _state["_init_task"]
        except asyncio.CancelledError:
            pass
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

@app.middleware("http")
async def log_observability_metrics(request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000
    
    path = request.url.path
    if path.startswith("/api/fs") or path in ["/query", "/ingest"]:
        # Log metric in background thread
        import asyncio
        from src.utils.metrics import log_metric
        loop = asyncio.get_event_loop()
        # Avoid duplicate logging for search since we log search specifically
        if path != "/api/fs/search":
            loop.run_in_executor(None, log_metric, path, process_time)
            
    return response

class Query(BaseModel):
    question: str
    taskLabels: list[str] | None = None

@app.post("/query")
def query(req: Query):
    qe = _state.get("qe")
    if qe is None:
        raise HTTPException(
            status_code=503,
            detail=f"Service initializing. Error: {_state.get('init_error', 'None')}"
        )
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
        "error": _state.get("init_error"),
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

# --- Virtual FS Models ---
class UserContextModel(BaseModel):
    userId: str
    groups: list[str]
    tenantId: str

class FSListRequest(BaseModel):
    user: UserContextModel
    path: str

class FSReadRequest(BaseModel):
    user: UserContextModel
    path: str
    offset: int | None = 0
    limit: int | None = 50000

class FSSearchRequest(BaseModel):
    user: UserContextModel
    query: str
    mode: str
    pathPrefix: str | None = None
    maxResults: int | None = 10

class FSFindRequest(BaseModel):
    user: UserContextModel
    tags: list[str] | None = None
    type: str | None = None
    source: str | None = None
    pathPrefix: str | None = None

class FSStatRequest(BaseModel):
    user: UserContextModel
    path: str

# Spec Models
class SpecListRequest(BaseModel):
    user: UserContextModel
    specPath: str

class SpecGetRequest(BaseModel):
    user: UserContextModel
    specPath: str
    method: str
    route: str

class SpecSchemaRequest(BaseModel):
    user: UserContextModel
    specPath: str
    schemaName: str

class SpecSearchRequest(BaseModel):
    user: UserContextModel
    specPath: str
    query: str

# PDF Models
class PDFListRequest(BaseModel):
    user: UserContextModel
    pdfPath: str

class PDFSectionRequest(BaseModel):
    user: UserContextModel
    pdfPath: str
    sectionId: str

class PDFPagesRequest(BaseModel):
    user: UserContextModel
    pdfPath: str
    startPage: int
    endPage: int

class PDFSearchRequest(BaseModel):
    user: UserContextModel
    pdfPath: str
    query: str


# Helper for RBAC Validation
def _validate_path_rbac(user: UserContextModel, path: str) -> dict:
    normalized_path = path.replace("\\", "/").strip("/")
    path_set, _, meta_map = fs_runtime.get_pruned_fs(user.groups, is_admin=False)
    if normalized_path not in path_set:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied or resource '{path}' not found under current RBAC context."
        )
    return meta_map[normalized_path]


# --- Virtual FS Endpoints ---

@app.post("/api/fs/rebuild")
def fs_rebuild():
    try:
        duration = fs_runtime.rebuild()
        return {"status": "ok", "rebuildDurationMs": duration}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rebuild PathTree: {str(e)}")

@app.post("/api/fs/list")
def fs_list(req: FSListRequest):
    normalized_path = req.path.replace("\\", "/").strip("/")
    _, dir_map, _ = fs_runtime.get_pruned_fs(req.user.groups, is_admin=False)
    
    entries = dir_map.get(normalized_path, [])
    return {
        "path": req.path,
        "entries": entries
    }

@app.post("/api/fs/read")
def fs_read(req: FSReadRequest):
    meta = _validate_path_rbac(req.user, req.path)
    normalized_path = req.path.replace("\\", "/").strip("/")
    
    offset = req.offset or 0
    limit = req.limit or 50000
    
    if meta.get("lazy", False):
        content = lazy_resolver.resolve(normalized_path, meta, offset, limit)
        total_length = lazy_resolver.get_total_length(normalized_path, meta)
        has_more = offset + limit < total_length
    else:
        # Reconstruct from disk if present, else from Chroma DB
        docs_root = os.path.abspath(os.path.join(workspace_root, "docs"))
        local_file = os.path.join(docs_root, normalized_path)
        
        # If it doesn't end with .md and isn't found, try appending .md
        if not os.path.exists(local_file) and not normalized_path.endswith(".md"):
            local_file += ".md"
            
        if os.path.exists(local_file) and os.path.isfile(local_file):
            try:
                with open(local_file, "r", encoding="utf-8", errors="ignore") as f:
                    full_content = f.read()
            except Exception as e:
                full_content = f"Error reading file: {str(e)}"
        else:
            # Fallback to Chroma
            import chromadb
            client = chromadb.PersistentClient(path=chroma_dir)
            collection = client.get_collection("torquequery")
            results = collection.get(where={"file_path": normalized_path}, include=["documents", "metadatas"])
            if not results or not results.get("documents"):
                # Try with backslashes for windows compatibility in DB keys
                win_path = normalized_path.replace("/", "\\")
                results = collection.get(where={"file_path": win_path}, include=["documents", "metadatas"])
                
            if results and results.get("documents"):
                docs_with_meta = []
                for doc, m in zip(results["documents"], results["metadatas"]):
                    idx = m.get("chunk_index", m.get("index", 0))
                    docs_with_meta.append((doc, idx))
                docs_with_meta.sort(key=lambda x: x[1])
                full_content = "\n\n".join(d[0] for d in docs_with_meta)
            else:
                full_content = ""
                
        total_length = len(full_content)
        content = full_content[offset : offset + limit]
        has_more = offset + limit < total_length
        
    return {
        "path": req.path,
        "type": meta.get("type", "page"),
        "content": content,
        "source": meta.get("source", "mintlify"),
        "hasMore": has_more,
        "totalLength": total_length
    }

@app.post("/api/fs/search")
def fs_search(req: FSSearchRequest):
    start_time = time.time()
    path_set, _, _ = fs_runtime.get_pruned_fs(req.user.groups, is_admin=False)
    matches = query_planner.search(
        query=req.query,
        mode=req.mode,
        path_set=path_set,
        path_prefix=req.pathPrefix,
        max_results=req.maxResults or 10
    )
    
    duration_ms = (time.time() - start_time) * 1000
    from src.utils.metrics import log_metric
    log_metric("/api/fs/search", duration_ms, {
        "mode": req.mode,
        "pathPrefix": req.pathPrefix,
        "matchesCount": len(matches)
    })
    
    return {
        "pattern": {
            "query": req.query,
            "mode": req.mode
        },
        "matches": matches
    }

@app.post("/api/fs/find")
def fs_find(req: FSFindRequest):
    _, _, meta_map = fs_runtime.get_pruned_fs(req.user.groups, is_admin=False)
    matched_paths = []
    
    for path, meta in meta_map.items():
        # Apply filters
        if req.pathPrefix and not path.startswith(req.pathPrefix):
            continue
        if req.type and meta.get("type") != req.type:
            continue
        if req.source and meta.get("source") != req.source:
            continue
        if req.tags:
            meta_tags = [t.lower() for t in meta.get("tags", [])]
            if not all(t.lower() in meta_tags for t in req.tags):
                continue
        matched_paths.append(path)
        
    return matched_paths

@app.post("/api/fs/stat")
def fs_stat(req: FSStatRequest):
    meta = _validate_path_rbac(req.user, req.path)
    return {
        "path": req.path,
        "meta": meta
    }


# --- Spec Tools Endpoints ---

@app.post("/api/fs/spec/list")
def api_spec_list(req: SpecListRequest):
    _validate_path_rbac(req.user, req.specPath)
    
    # Read the spec file content fully
    read_req = FSReadRequest(user=req.user, path=req.specPath, offset=0, limit=200000)
    read_res = fs_read(read_req)
    spec_content = read_res["content"]
    
    from src.tools.spec_ast import list_endpoints
    endpoints = list_endpoints(spec_content)
    return endpoints

@app.post("/api/fs/spec/get")
def api_spec_get(req: SpecGetRequest):
    _validate_path_rbac(req.user, req.specPath)
    
    read_req = FSReadRequest(user=req.user, path=req.specPath, offset=0, limit=200000)
    read_res = fs_read(read_req)
    spec_content = read_res["content"]
    
    from src.tools.spec_ast import get_endpoint
    endpoint = get_endpoint(spec_content, req.method, req.route)
    if not endpoint:
        raise HTTPException(status_code=404, detail=f"Endpoint {req.method} {req.route} not found in spec.")
    return endpoint

@app.post("/api/fs/spec/schema")
def api_spec_schema(req: SpecSchemaRequest):
    _validate_path_rbac(req.user, req.specPath)
    
    read_req = FSReadRequest(user=req.user, path=req.specPath, offset=0, limit=200000)
    read_res = fs_read(read_req)
    spec_content = read_res["content"]
    
    from src.tools.spec_ast import find_schema
    schema = find_schema(spec_content, req.schemaName)
    if not schema:
        raise HTTPException(status_code=404, detail=f"Schema {req.schemaName} not found in spec.")
    return schema

@app.post("/api/fs/spec/search")
def api_spec_search(req: SpecSearchRequest):
    _validate_path_rbac(req.user, req.specPath)
    
    read_req = FSReadRequest(user=req.user, path=req.specPath, offset=0, limit=200000)
    read_res = fs_read(read_req)
    spec_content = read_res["content"]
    
    from src.tools.spec_ast import search_spec
    result = search_spec(spec_content, req.query)
    return result


# --- PDF Tools Endpoints ---

def _get_pdf_bytes(user: UserContextModel, pdf_path: str) -> bytes:
    meta = _validate_path_rbac(user, pdf_path)
    normalized_path = pdf_path.replace("\\", "/").strip("/")
    
    # Check if a mock file exists locally
    mock_file_path = os.path.join(workspace_root, "torquequery", "storage", "mock_lazy", normalized_path)
    if os.path.exists(mock_file_path) and os.path.isfile(mock_file_path):
        try:
            with open(mock_file_path, "rb") as f:
                return f.read()
        except Exception:
            pass
            
    # Fallback to simulated PDF outline bytes (just dummy ascii payload)
    return b"%PDF-1.4 simulated pdf outline payload"

@app.post("/api/fs/pdf/list")
def api_pdf_list(req: PDFListRequest):
    pdf_bytes = _get_pdf_bytes(req.user, req.pdfPath)
    from src.tools.pdf_extractor import list_sections
    return list_sections(pdf_bytes)

@app.post("/api/fs/pdf/extract-section")
def api_pdf_extract_section(req: PDFSectionRequest):
    pdf_bytes = _get_pdf_bytes(req.user, req.pdfPath)
    from src.tools.pdf_extractor import extract_section
    content = extract_section(pdf_bytes, req.sectionId)
    return {"content": content}

@app.post("/api/fs/pdf/extract-pages")
def api_pdf_extract_pages(req: PDFPagesRequest):
    pdf_bytes = _get_pdf_bytes(req.user, req.pdfPath)
    from src.tools.pdf_extractor import extract_pages
    content = extract_pages(pdf_bytes, req.startPage, req.endPage)
    return {"content": content}

@app.post("/api/fs/pdf/search")
def api_pdf_search(req: PDFSearchRequest):
    meta = _validate_path_rbac(req.user, req.pdfPath)
    pdf_bytes = _get_pdf_bytes(req.user, req.pdfPath)
    
    from src.tools.pdf_extractor import extract_pages
    # Extract first 50 pages for searching
    content = extract_pages(pdf_bytes, 1, 50)
    
    snippets = []
    for line in content.split("\n"):
        if req.query.lower() in line.lower():
            snippets.append(line.strip())
            
    return {
        "path": req.pdfPath,
        "snippets": snippets[:5]
    }

@app.get("/api/fs/metrics")
def fs_metrics():
    from src.utils.metrics import get_metrics_summary
    return get_metrics_summary()
