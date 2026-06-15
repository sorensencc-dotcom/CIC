from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.core import StorageContext, VectorStoreIndex, Settings
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding

def configure_models(llm_model: str, embed_model: str):
    Settings.llm = Ollama(model=llm_model)
    Settings.embed_model = OllamaEmbedding(model=embed_model)

def build_storage(chroma_dir: str):
    vs = ChromaVectorStore(persist_dir=chroma_dir)
    return StorageContext.from_defaults(vector_store=vs)

def build_index(nodes, storage_context):
    index = VectorStoreIndex.from_nodes(nodes, storage_context=storage_context)
    index.storage_context.vector_store.persist()
    return index
