import sys
import os

# Ensure project root is in the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.utils.config import load_config
from src.ingestion.loader import load_documents
from src.ingestion.chunker import chunk_documents
from src.ingestion.indexer import configure_models, build_storage, build_index

def main():
    cfg = load_config()
    configure_models(cfg["models"]["llm"], cfg["models"]["embedding"])
    docs = load_documents(cfg["paths"]["docs_root"], cfg["paths"]["mkdocs_yml"])
    nodes = chunk_documents(docs, cfg["chunking"]["chunk_size"], cfg["chunking"]["chunk_overlap"])
    storage = build_storage(cfg["paths"]["chroma_dir"])
    build_index(nodes, storage)

if __name__ == "__main__":
    main()
