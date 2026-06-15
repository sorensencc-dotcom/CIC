from tiktoken import get_encoding

_enc = get_encoding("cl100k_base")

def count_tokens(text: str) -> int:
    return len(_enc.encode(text))
