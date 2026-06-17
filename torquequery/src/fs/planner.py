import math
import re
from typing import List, Dict, Set, Any, Optional
import chromadb

class SimpleBM25:
    """
    A lightweight, deterministic Python implementation of BM25
    for keyword scoring over a list of chunks.
    """
    def __init__(self, corpus: List[str], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.corpus_size = len(corpus)
        self.avg_doc_len = 0.0
        self.doc_lens = []
        self.doc_term_freqs: List[Dict[str, int]] = []
        self.df: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}
        
        if self.corpus_size == 0:
            return
            
        total_len = 0
        for doc in corpus:
            tokens = self._tokenize(doc)
            self.doc_lens.append(len(tokens))
            total_len += len(tokens)
            
            tf: Dict[str, int] = {}
            for t in tokens:
                tf[t] = tf.get(t, 0) + 1
            self.doc_term_freqs.append(tf)
            
            for t in tf.keys():
                self.df[t] = self.df.get(t, 0) + 1
                
        self.avg_doc_len = total_len / self.corpus_size
        
        # Compute IDF
        for t, freq in self.df.items():
            # Standard BM25 IDF with smoothing
            self.idf[t] = math.log((self.corpus_size - freq + 0.5) / (freq + 0.5) + 1.0)

    def _tokenize(self, text: str) -> List[str]:
        # Lowercase and split by non-alphanumeric characters
        return [w for w in re.findall(r'[a-zA-Z0-9]+', text.lower()) if w]

    def score(self, query: str, doc_idx: int) -> float:
        query_tokens = self._tokenize(query)
        if not query_tokens or doc_idx >= len(self.doc_term_freqs):
            return 0.0
            
        score = 0.0
        doc_len = self.doc_lens[doc_idx]
        tf = self.doc_term_freqs[doc_idx]
        
        for t in query_tokens:
            if t not in self.idf:
                continue
            t_tf = tf.get(t, 0)
            numerator = t_tf * (self.k1 + 1)
            denominator = t_tf + self.k1 * (1 - self.b + self.b * doc_len / (self.avg_doc_len or 1.0))
            score += self.idf[t] * (numerator / denominator)
            
        return score

class QueryPlanner:
    def __init__(self, chroma_dir: str):
        self.chroma_dir = chroma_dir

    def search(
        self,
        query: str,
        mode: str,
        path_set: Set[str],
        path_prefix: Optional[str] = None,
        max_results: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Execute coarse->fine search pipeline over indexed documents.
        """
        # 1. Fetch chunks matching path constraints
        chunks = self._fetch_all_chunks(path_set, path_prefix)
        if not chunks:
            return []

        # 2. Coarse Ranking Phase
        ranked_chunks = []
        if mode == "exact":
            ranked_chunks = self._exact_coarse_search(query, chunks)
        elif mode == "regex":
            ranked_chunks = self._regex_coarse_search(query, chunks)
        elif mode == "semantic":
            ranked_chunks = self._semantic_coarse_search(query, chunks)
        else:
            # Fallback to exact
            ranked_chunks = self._exact_coarse_search(query, chunks)

        # Truncate to a candidate size before fine regex filtering
        candidates = ranked_chunks[:50]

        # 3. Fine Regex/Substring Filter Phase
        matches = []
        for cand in candidates:
            text = cand["text"]
            snippets = []
            
            # Find snippet lines matching the query
            if mode == "regex":
                try:
                    pattern = re.compile(query, re.IGNORECASE)
                    for line in text.split("\n"):
                        if pattern.search(line):
                            snippets.append(line.strip())
                except Exception:
                    # Fallback to string matching if regex compile fails
                    for line in text.split("\n"):
                        if query.lower() in line.lower():
                            snippets.append(line.strip())
            else:
                # String matching for exact / semantic modes
                for line in text.split("\n"):
                    if query.lower() in line.lower():
                        snippets.append(line.strip())
                        
            if snippets:
                matches.append({
                    "path": cand["path"],
                    "snippets": snippets[:3]  # Return top 3 snippets per document
                })

        # Group matches by path
        grouped: Dict[str, List[str]] = {}
        for m in matches:
            path = m["path"]
            if path not in grouped:
                grouped[path] = []
            grouped[path].extend(m["snippets"])

        result = [
            {"path": path, "snippets": list(dict.fromkeys(snippets))[:5]} # deduplicate snippets
            for path, snippets in grouped.items()
        ]

        return result[:max_results]

    def _fetch_all_chunks(self, path_set: Set[str], path_prefix: Optional[str] = None) -> List[Dict[str, Any]]:
        chunks = []
        try:
            client = chromadb.PersistentClient(path=self.chroma_dir)
            collections = [col.name for col in client.list_collections()]
            if "torquequery" not in collections:
                return []
                
            collection = client.get_collection("torquequery")
            results = collection.get(include=["documents", "metadatas"])
            
            if results and results.get("documents"):
                for doc, meta in zip(results["documents"], results["metadatas"]):
                    if not meta or "file_path" not in meta:
                        continue
                    file_path = meta["file_path"].replace("\\", "/")
                    
                    # Apply PathSet filter
                    if file_path not in path_set:
                        continue
                        
                    # Apply pathPrefix filter
                    if path_prefix and not file_path.startswith(path_prefix):
                        continue
                        
                    chunks.append({
                        "path": file_path,
                        "text": doc,
                        "meta": meta
                    })
        except Exception as e:
            print(f"Warning: Failed to fetch chunks for search: {str(e)}")
        return chunks

    def _exact_coarse_search(self, query: str, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # Python BM25 ranking
        corpus = [c["text"] for c in chunks]
        bm25 = SimpleBM25(corpus)
        
        scored = []
        for idx, chunk in enumerate(chunks):
            score = bm25.score(query, idx)
            if score > 0.0 or query.lower() in chunk["text"].lower():
                # Add a tiny boost if exact match is found
                boost = 1.0 if query.lower() in chunk["text"].lower() else 0.0
                scored.append((chunk, score + boost))
                
        scored.sort(key=lambda x: x[1], reverse=True)
        return [item[0] for item in scored]

    def _regex_coarse_search(self, regex_pattern: str, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # Pre-compile regex
        try:
            rx = re.compile(regex_pattern, re.IGNORECASE)
        except Exception:
            return self._exact_coarse_search(regex_pattern, chunks)

        scored = []
        for chunk in chunks:
            # Score based on number of regex matches in text
            matches = len(rx.findall(chunk["text"]))
            if matches > 0:
                scored.append((chunk, float(matches)))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [item[0] for item in scored]

    def _semantic_coarse_search(self, query: str, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        # 1. BM25 Run
        corpus = [c["text"] for c in chunks]
        bm25 = SimpleBM25(corpus)
        bm25_scores = [bm25.score(query, idx) for idx in range(len(chunks))]
        
        # Rank by BM25
        bm25_ranked = sorted(
            range(len(chunks)), 
            key=lambda idx: bm25_scores[idx], 
            reverse=True
        )

        # 2. Vector Search Run
        vector_scores = self._query_vector_similarity(query, len(chunks))
        # Map path:score
        vector_score_map = {}
        for path, score in vector_scores:
            vector_score_map[path] = score

        # Rank by Vector
        vector_ranked = sorted(
            range(len(chunks)),
            key=lambda idx: vector_score_map.get(chunks[idx]["path"], 0.0),
            reverse=True
        )

        # 3. Reciprocal Rank Fusion (RRF)
        # RRF(d) = 1 / (60 + rank_bm25(d)) + 1 / (60 + rank_vector(d))
        rrf_scores = {}
        for idx in range(len(chunks)):
            # BM25 Rank
            bm25_rank = bm25_ranked.index(idx) + 1
            # Vector Rank
            vector_rank = vector_ranked.index(idx) + 1
            
            score = 1.0 / (60.0 + bm25_rank) + 1.0 / (60.0 + vector_rank)
            rrf_scores[idx] = score

        scored_chunks = [
            (chunks[idx], rrf_scores[idx])
            for idx in range(len(chunks))
        ]
        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        return [item[0] for item in scored_chunks]

    def _query_vector_similarity(self, query: str, top_k: int) -> List[tuple[str, float]]:
        # Get query embeddings using Chroma and returns path -> score mappings
        scores = []
        try:
            client = chromadb.PersistentClient(path=self.chroma_dir)
            collections = [col.name for col in client.list_collections()]
            if "torquequery" not in collections:
                return []
                
            collection = client.get_collection("torquequery")
            
            # Query using LlamaIndex embed model to avoid downloading Chroma default models
            from llama_index.core import Settings
            if Settings.embed_model:
                query_embedding = Settings.embed_model.get_text_embedding(query)
                results = collection.query(query_embeddings=[query_embedding], n_results=min(top_k, 50))
            else:
                # Fallback if embed_model not set
                results = collection.query(query_texts=[query], n_results=min(top_k, 50))
            
            if results and results.get("distances") and results.get("metadatas"):
                for dists, metadatas in zip(results["distances"], results["metadatas"]):
                    for d, m in zip(dists, metadatas):
                        if not m or "file_path" not in m:
                            continue
                        file_path = m["file_path"].replace("\\", "/")
                        # Convert cosine distance to similarity
                        similarity = 1.0 - d
                        scores.append((file_path, similarity))
        except Exception as e:
            print(f"Warning: Failed vector similarity query: {str(e)}")
        return scores
