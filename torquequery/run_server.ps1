$python = "python"
& $python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --log-level debug 2>&1 | Tee-Object -FilePath "server_err.log"
