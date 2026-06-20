import os
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["CUDA_VISIBLE_DEVICES"] = ""

print("Importing huggingface_hub...", flush=True)
import huggingface_hub
print("huggingface_hub imported successfully!", flush=True)

print("Importing transformers...", flush=True)
import transformers
print("transformers imported successfully!", flush=True)
