from pathlib import Path
from llama_index.core import Document
from .frontmatter import extract_frontmatter, strip_frontmatter
from .mkdocs_nav import load_nav, flatten_nav

def load_documents(docs_root: str, mkdocs_yml: str):
    nav = flatten_nav(load_nav(mkdocs_yml))
    docs = []
    root = Path(docs_root)

    for path in root.rglob("*.md"):
        raw = path.read_text(encoding="utf-8")
        fm = extract_frontmatter(raw)
        body = strip_frontmatter(raw)
        rel = str(path.relative_to(root))
        section = nav.get(rel, [])

        docs.append(
            Document(
                text=body,
                metadata={
                    "file_path": rel,
                    "title": fm.get("title", path.name),
                    "tags": ",".join(fm.get("tags", [])),
                    "mkdocs_section": ",".join(section),
                    "mkdocs_path": " > ".join(section),
                },
            )
        )
    return docs
