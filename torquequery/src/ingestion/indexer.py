import chromadb
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.core import StorageContext, VectorStoreIndex, Settings
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding

COLLECTION_NAME = "torquequery"

def configure_models(llm_model: str, embed_model: str):
    import os
    ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    Settings.llm = Ollama(model=llm_model, base_url=ollama_host)
    Settings.embed_model = OllamaEmbedding(model_name=embed_model, base_url=ollama_host)

def build_storage(chroma_dir: str):
    client = chromadb.PersistentClient(path=chroma_dir)
    collection = client.get_or_create_collection(COLLECTION_NAME)
    vs = ChromaVectorStore(chroma_collection=collection)
    return StorageContext.from_defaults(vector_store=vs)

def build_index(nodes, storage_context):
    index = VectorStoreIndex(nodes, storage_context=storage_context)
    return index
