import yaml
from pathlib import Path

CONFIG_PATH = Path("config/settings.yaml")

def load_config():
    with CONFIG_PATH.open("r") as f:
        return yaml.safe_load(f)
