from src.utils.tokens import count_tokens, truncate_tokens

def pack_context(nodes, max_tokens: int, reserved: int = 1024):
    budget = max_tokens - reserved
    chunks = []
    used = 0
    for sn in nodes:
        text = sn.node.text
        t = count_tokens(text)
        if used + t > budget:
            remaining = budget - used
            if remaining > 0:
                truncated_text = truncate_tokens(text, remaining)
                if truncated_text.strip():
                    chunks.append(truncated_text)
            break
        chunks.append(text)
        used += t
    return "\n\n".join(chunks)
