# TorqueQuery

TorqueQuery is a local, deterministic, MkDocs-aware documentation RAG service.

## Installation

```bash
pip install -e .
```

## Usage

1. Ingest docs:
```bash
python scripts/ingest.py
```

2. Run server:
```bash
uvicorn src.main:app --reload
```
