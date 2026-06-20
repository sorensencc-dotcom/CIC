# Phase‑26 — TorqueQuery Readiness Checklist

## A. Workspace & Structure
- [x] `cic/torquequery/` workspace created
- [x] `pyproject.toml` defined
- [x] `config/settings.yaml` pinned
- [x] `src/` folder with ingestion + RAG engine
- [x] `scripts/ingest.py` present
- [x] `storage/chroma/` exists

## B. Ingestion Pipeline
- [x] MkDocs nav parsed from `mkdocs.yml`
- [x] YAML front‑matter extracted (title, tags)
- [x] Metadata attached to nodes:
  - `file_path`
  - `mkdocs_section`
  - `mkdocs_path`
  - `tags`
- [x] Chunking deterministic (`1024/128`)
- [x] Embeddings generated via Ollama
- [x] Vector index persisted to Chroma

## C. Retrieval Pipeline
- [x] Dense retrieval (embedding similarity)
- [x] Semantic reranker initialized (BGE‑Reranker)
- [x] Tag‑aware reranker implemented
- [x] Token‑aware context packing (8192 max)
- [x] Strict system prompt enforced

## D. API Layer
- [x] `/query` returns strict JSON schema
- [x] `/ingest` triggers ingestion
- [x] `/health` exposes version, models, config
- [x] FastAPI server starts cleanly
- [x] Uvicorn hot‑reload works

## E. CIC Integration
- [x] TypeScript SDK generated
- [x] CIC agent manifest created
- [x] Agent wrapper added to CIC graph
- [x] CIC orchestrator checks TorqueQuery before remote LLM
- [x] CIC autoscheduler rule added (nightly ingestion)

## F. Determinism & Stability
- [x] All model versions pinned
- [x] All chunking parameters pinned
- [x] All retrieval parameters pinned
- [x] JSON schema locked
- [ ] Snapshot tests added

## G. Smoke Test
- [x] `make ingest` runs successfully
- [x] `make serve` starts server
- [x] `/health` returns healthy
- [x] `/query` returns valid JSON
- [x] CIC agent successfully resolves a real doc question
