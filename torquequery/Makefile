.PHONY: ingest serve test watch

PYTHON := python3

ingest:
	$(PYTHON) scripts/ingest.py

serve:
	uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

test:
	pytest -q

watch:
	$(PYTHON) scripts/watch.py
