from src.utils.tokens import count_tokens

def pack_context(nodes, max_tokens: int, reserved: int = 1024):
    budget = max_tokens - reserved
    chunks = []
    used = 0
    for sn in nodes:
        text = sn.node.text
        t = count_tokens(text)
        if used + t > budget:
            break
        chunks.append(text)
        used += t
    return "\n\n".join(chunks)
