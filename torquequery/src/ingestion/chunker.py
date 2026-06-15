from llama_index.core.node_parser import SentenceSplitter

def chunk_documents(documents, chunk_size: int, chunk_overlap: int):
    parser = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    return parser.get_nodes_from_documents(documents)
