# Planning Engine API Reference

**Base URL:** `http://localhost:3114` (or configured port)  
**Content-Type:** `application/json`

## Health Check

**GET /health**

Health check endpoint for load balancers and monitoring.

**Response:**
```json
{
  "status": "ok",
  "service": "planning-engine",
  "timestamp": "2026-06-20T04:50:00.000Z"
}
```

**Status Codes:** `200 OK`

---

## Navigate to URL

**POST /navigate**

Navigate to a URL with hydration detection, DOM extraction, and screenshot capture.

**Request:**
```json
{
  "url": "https://example.com",
  "retryCount": 2,
  "timeoutMs": 10000
}
```

**Parameters:**
- `url` (string, required): URL to navigate to
- `retryCount` (number, optional): Max retry attempts on failure (default: 2)
- `timeoutMs` (number, optional): Session checkout timeout in ms (default: 10000)

**Response:**
```json
{
  "dom": "<html>...</html>",
  "hydrationScore": 80,
  "latencyMs": 1250,
  "screenshot": "<base64-encoded-png>"
}
```

**Response Fields:**
- `dom`: Full HTML of page (outer HTML)
- `hydrationScore`: 0-100, framework hydration quality
- `latencyMs`: Round-trip time including navigation + detection
- `screenshot`: Full-page screenshot as base64 PNG

**Status Codes:**
- `200 OK`: Navigation successful
- `400 Bad Request`: Missing `url` parameter
- `500 Internal Server Error`: All retries exhausted

**Error Response:**
```json
{
  "error": "Navigation failed after 2 retries: timeout"
}
```

**Retry Behavior:**
- Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms, 5000ms (capped)
- Retries on: transient errors, timeouts, navigation failures
- Does NOT retry on: invalid URL, page crashes with no recovery

**Example:**
```bash
curl -X POST http://localhost:3114/navigate \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "retryCount": 1,
    "timeoutMs": 5000
  }'
```

---

## Sample URLs

**POST /sample**

Sample multiple URL paths and select best DOM based on completeness.

**Request:**
```json
{
  "baseUrl": "https://example.com"
}
```

**Parameters:**
- `baseUrl` (string, required): Base URL to sample paths from

**Response:**
```json
{
  "selectedUrl": "https://example.com/services",
  "completenessScore": 78,
  "dom": "<html>...</html>"
}
```

**Response Fields:**
- `selectedUrl`: Winning URL path
- `completenessScore`: 0-100, DOM richness score
- `dom`: Full HTML of selected page

**Sampling Strategy:**
1. Tries paths: `/`, `/home`, `/services`
2. Scores each based on: node count, text density, image count, link count
3. Filters out scores < 20
4. Returns highest scoring, falls back to best available

**Status Codes:**
- `200 OK`: Sampling complete (at least one URL succeeded)
- `400 Bad Request`: Missing `baseUrl` parameter
- `500 Internal Server Error`: All URLs failed

**Example:**
```bash
curl -X POST http://localhost:3114/sample \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://example.com"}'
```

---

## Warm Pool Metrics

**GET /metrics**

Get current warm pool health and performance metrics.

**Response:**
```json
{
  "poolSize": 3,
  "targetSize": 3,
  "checkoutCount": 42,
  "checkinCount": 42,
  "spawnCount": 3,
  "recycleCount": 0,
  "avgLatencyMs": 1200,
  "healthySessionCount": 3,
  "unhealthySessionCount": 0,
  "totalNavigations": 42
}
```

**Response Fields:**
- `poolSize`: Current sessions in pool
- `targetSize`: Configured pool size
- `checkoutCount`: Total checkouts (cumulative)
- `checkinCount`: Total checkins (cumulative)
- `spawnCount`: Total sessions spawned (cumulative)
- `recycleCount`: Sessions recycled due to age/errors (cumulative)
- `avgLatencyMs`: Average navigation latency across pool (rounded)
- `healthySessionCount`: Sessions marked healthy
- `unhealthySessionCount`: Sessions marked unhealthy (pending recycle)
- `totalNavigations`: Total successful navigations (cumulative)

**Status Codes:** `200 OK`

**Example:**
```bash
curl http://localhost:3114/metrics
```

**Interpretation:**
- If `poolSize < targetSize`: Sessions being recycled/replaced
- If `unhealthySessionCount > 0`: Sessions will be recycled on next checkin
- If `avgLatencyMs` climbing: Navigation degradation (check network)
- If `recycleCount` high: Pool churn (may need larger pool or longer session TTL)

---

## Cleanup Resources

**POST /cleanup**

Drain warm pool and cleanup all resources. Useful before shutdown or testing.

**Request:** (no body)

**Response:**
```json
{
  "status": "cleaned"
}
```

**Status Codes:**
- `200 OK`: Cleanup successful
- `500 Internal Server Error`: Cleanup failed (still may be partial)

**Behavior:**
- Closes all sessions in pool
- Stops health check timer
- Clears pool
- Safe to call multiple times (idempotent)

**Example:**
```bash
curl -X POST http://localhost:3114/cleanup
```

**Note:** Server automatically calls cleanup on SIGTERM. Manual call useful for:
- Integration tests (cleanup between tests)
- Graceful reload in production
- Memory leak debugging

---

## Error Handling

All errors return JSON with `error` field:

```json
{
  "error": "description of error"
}
```

**Common Errors:**

| Error | Status | Cause | Mitigation |
|-------|--------|-------|-----------|
| `url required` | 400 | Missing URL in request | Add `url` field |
| `baseUrl required` | 400 | Missing baseUrl in request | Add `baseUrl` field |
| `Navigation failed after X retries` | 500 | URL unreachable/timeout | Check URL, increase timeout |
| `Page crashed` | 500 | Browser crash | Automatic retry, may succeed |
| `WARM_POOL_EMPTY_TIMEOUT` | 500 | No sessions available | Wait for recycle or expand pool |

---

## Environment Variables

```bash
PORT=3114              # Server port (default: 3114)
WARM_POOL_SIZE=3       # Session pool size (default: 3)
```

**Example:**
```bash
PORT=3000 WARM_POOL_SIZE=5 npm start
```

---

## Performance Tips

1. **Pool Size:** 3-5 for light load, 10+ for high concurrency
2. **Timeouts:** 10s checkout, 30s overall per request for reliability
3. **Retries:** 2-3 retries for transient errors, higher for intermittent networks
4. **Metrics:** Poll every 30s for monitoring, check `avgLatencyMs` for degradation
5. **Cleanup:** Call cleanup on app restart to reset metrics and session state

---

## Logging

Server logs to console in JSON format:

```json
{"level":"INFO","event":"planning.server.started","port":3114,"warmPoolSize":3}
{"level":"INFO","event":"adapter.navigate.success","url":"https://example.com","sessionId":"abc-123","latencyMs":1200}
{"level":"ERROR","event":"planning.navigate.error","url":"https://example.com","error":"timeout"}
```

**Log Events:**
- `planning.server.started`: Server initialization
- `planning.server.adapter_initialized`: Warm pool ready
- `adapter.navigate.attempt`: Navigation started
- `adapter.navigate.success`: Navigation completed
- `adapter.navigate.attempt_failed`: Single retry attempt failed
- `adapter.navigate.exhausted_retries`: All retries exhausted
- `planning.*.error`: Endpoint error
