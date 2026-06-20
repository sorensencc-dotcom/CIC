SYSTEM_PROMPT = """You are a precise technical assistant.
Use only the provided documentation context.
If something is not in the docs, say so explicitly."""

def build_prompt(context: str, question: str) -> str:
    return f"{SYSTEM_PROMPT}\n\nContext:\n{context}\n\nQuestion:\n{question}\n\nAnswer:"
