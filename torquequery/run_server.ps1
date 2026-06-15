$python = "C:\Users\soren\AppData\Local\Programs\Python\Python312\python.exe"
$out = & $python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --log-level debug 2>&1
$out | Out-File -FilePath "server_err.log" -Encoding utf8
