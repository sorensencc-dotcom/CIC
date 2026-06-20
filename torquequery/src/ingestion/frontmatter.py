import re
import yaml

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)

def extract_frontmatter(text: str):
    m = FM_RE.match(text)
    if not m:
        return {}
    return yaml.safe_load(m.group(1)) or {}

def strip_frontmatter(text: str) -> str:
    return FM_RE.sub("", text)
