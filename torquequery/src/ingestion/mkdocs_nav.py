import yaml
from pathlib import Path

def load_nav(mkdocs_path: str):
    with Path(mkdocs_path).open("r") as f:
        data = yaml.safe_load(f)
    return data.get("nav", [])

def flatten_nav(nav, parents=None, mapping=None):
    if mapping is None:
        mapping = {}
    if parents is None:
        parents = []
    for item in nav:
        for title, value in item.items():
            if isinstance(value, str):
                mapping[value] = parents + [title]
            else:
                flatten_nav(value, parents + [title], mapping)
    return mapping
