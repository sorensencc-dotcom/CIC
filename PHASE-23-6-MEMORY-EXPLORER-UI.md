# Phase 23.6: Memory Explorer Web UI

**Status:** Roadmap  
**Duration:** 2 weeks (2026-06-14 to 2026-06-28)  
**Dependencies:** Phase 23.2 (MemoryStore), Phase 23.4 (Query API), Phase 23.5 (Retention)  
**Owner:** Memory Infrastructure Team  

---

## Overview

Web UI for CIC memory infrastructure. Exposes:
- **Event Browser**: search/filter memory events, view lineage, trace agent interactions
- **Archive Manager**: restore archived entries, compliance audit, retention policy management
- **Stats Dashboard**: memory usage metrics, compression ratio, query performance, retention compliance

Builds on MemoryStore (23.2), Query API (23.4), and Retention/Archival (23.5).

---

## Goals

1. **Visibility**: inspect memory state without raw DB access
2. **Operability**: restore archives, manage retention, audit events
3. **Performance**: sub-100ms query latency, pagination for large result sets
4. **Security**: RBAC (read-only public, write via service account), audit logging

---

## Architecture

### Backend (Node/TypeScript + Express)

**Endpoints:**
- `GET /api/events` — query memory events (Query API wrapper)
- `GET /api/events/:id` — single event detail + lineage
- `GET /api/archives` — list archived entries
- `POST /api/archives/:id/restore` — restore archived entry
- `GET /api/stats` — memory usage, compression ratio, latency percentiles
- `GET /api/retention/policy` — current retention policy
- `PUT /api/retention/policy` — update policy (service account only)
- `GET /api/audit` — audit log of operations

**Auth:** Bearer token (service account) for write ops; read ops open.

### Frontend (React + TypeScript)

**Pages:**
1. **Event Browser** (`/events`)
   - Search bar (fulltext on content, agent_id, operation)
   - Filters: date range, operation type, agent, status
   - Results table: timestamp, agent, operation, memory_key, status
   - Click row → event detail view with JSON, lineage graph, related events

2. **Archive Manager** (`/archives`)
   - List archived entries: key, archived_at, size, compressed_ratio
   - Search/filter by key pattern
   - "Restore" button → confirm → restore to live memory
   - Show restore logs (success/failure)

3. **Stats Dashboard** (`/stats`)
   - **Memory Usage**: total entries, total size bytes, growth rate
   - **Compression**: bytes_saved, global ratio (0.0–1.0), per-profile breakdown
   - **Query Performance**: p50/p95/p99 latency by operation
   - **Retention**: entries archived today, total archived size, compliance status
   - Charts: time series, pie charts, heatmaps

4. **Retention Policy** (`/retention`)
   - Current policy (max_age_days, max_size_bytes, recompression_guard, keep_patterns)
   - Edit form (service account only)
   - Audit log of policy changes

**Tech Stack:**
- Next.js or React SPA
- TypeScript
- TanStack Query (caching)
- Recharts or ECharts (charts)
- TailwindCSS (styling)
- Jest + React Testing Library

---

## Implementation

### Phase 1: Backend API (Days 1–4)

**Files:**
- `src/memory-explorer/api/events.ts` — event search wrapper
- `src/memory-explorer/api/archives.ts` — archive restore, list
- `src/memory-explorer/api/stats.ts` — metrics aggregation
- `src/memory-explorer/api/retention.ts` — policy get/set
- `src/memory-explorer/api/auth.ts` — RBAC middleware
- `src/memory-explorer/server.ts` — Express app + route setup
- `src/memory-explorer/__tests__/api.test.ts` — API tests (50+ tests)

**Queries:** Reuse MemoryStore query methods + new aggregations (sum, count_by, percentiles).

**Auth:** Simple Bearer token in env `MEMORY_EXPLORER_SERVICE_TOKEN`. Public read; write requires token.

**Tests:**
- Event search (fulltext, filters, pagination)
- Archive restore (success, already_exists, corrupted)
- Stats aggregation (correctness, performance <100ms)
- Retention policy (get, set, validation)
- Auth (valid token, invalid token, public read)

---

### Phase 2: Frontend (Days 5–10)

**Files:**
- `src/memory-explorer/ui/pages/EventBrowser.tsx` — search + results + detail
- `src/memory-explorer/ui/pages/ArchiveManager.tsx` — archive list + restore
- `src/memory-explorer/ui/pages/StatsDashboard.tsx` — metrics charts
- `src/memory-explorer/ui/pages/RetentionPolicy.tsx` — policy editor
- `src/memory-explorer/ui/components/SearchBar.tsx` — unified search
- `src/memory-explorer/ui/components/ResultsTable.tsx` — paginated table
- `src/memory-explorer/ui/components/EventDetail.tsx` — event JSON + lineage
- `src/memory-explorer/ui/hooks/useEvents.ts` — TanStack Query hooks
- `src/memory-explorer/ui/hooks/useStats.ts`
- `src/memory-explorer/ui/__tests__/EventBrowser.test.tsx` — React tests (40+ tests)

**Routes:**
- `GET /events` → EventBrowser
- `GET /events/:id` → EventDetail
- `GET /archives` → ArchiveManager
- `GET /stats` → StatsDashboard
- `GET /retention` → RetentionPolicy

**Tests:**
- Search/filter behavior
- Restore dialog + confirm flow
- Stats chart rendering
- Auth error handling (403, token missing)
- Loading/error states

---

### Phase 3: Integration & Deployment (Days 11–14)

**Files:**
- `docker/Dockerfile.memory-explorer` — multi-stage build
- `k3d/kustomization.yaml` — K8s deployment
- `observability/dashboards/memory-explorer.json` — Grafana integration
- `docs/MEMORY_EXPLORER.md` — user guide

**Integration:**
- API metrics exported to Prometheus (response time, error rate, event count)
- Logs sent to Loki
- Grafana dashboard: request latency, event query volume, archive restore success rate

**Deployment:**
- Docker image: `cic:memory-explorer-1.0.0`
- K8s: 2 replicas, resource limits (256MB mem, 100m CPU)
- Reverse proxy: `/memory-explorer` → service
- Auth: env var `MEMORY_EXPLORER_SERVICE_TOKEN`

---

## Data Model

### Event (from MemoryStore)

```typescript
interface MemoryEvent {
  id: string;                          // uuid
  agent_id: string;                    // agent creating event
  operation: 'set' | 'get' | 'delete' | 'evict' | 'archive';
  memory_key: string;                  // key being accessed
  value?: any;                         // value (null for get/delete)
  status: 'success' | 'failure' | 'error';
  error?: string;                      // error message if status !== success
  metadata?: Record<string, unknown>;  // custom tags
  timestamp: ISO8601;
  lineage_id?: string;                 // trace ID for lineage
}
```

### Archive Entry

```typescript
interface ArchiveEntry {
  id: string;
  memory_key: string;
  value: any;
  archived_at: ISO8601;
  archived_by: string;                 // agent that archived
  size_bytes: number;
  compressed_ratio: number;            // bytes_out / bytes_in
  retention_policy_version: string;
  restore_attempts: number;
  last_restore_at?: ISO8601;
}
```

### Stats

```typescript
interface MemoryStats {
  memory_usage: {
    total_entries: number;
    total_size_bytes: number;
    growth_rate_bytes_per_hour: number;
  };
  compression: {
    bytes_saved: number;
    global_ratio: number;               // out / in
    by_profile: Record<string, number>; // profile → ratio
  };
  query_performance: {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    by_operation: Record<string, {p50_ms, p95_ms, p99_ms}>;
  };
  retention: {
    entries_archived_today: number;
    total_archived_size_bytes: number;
    policy_compliance_percent: number;  // % entries matching retention policy
  };
  timestamp: ISO8601;
}
```

---

## API Reference

### Events

**Query Memory Events**
```
GET /api/events?q=<fulltext>&operation=<op>&agent_id=<id>&start=<iso>&end=<iso>&limit=50&offset=0

Response: 200 OK
{
  "events": [MemoryEvent[], ...],
  "total": 10000,
  "limit": 50,
  "offset": 0
}
```

**Get Event Detail**
```
GET /api/events/:id

Response: 200 OK
{
  "event": MemoryEvent,
  "lineage": [MemoryEvent[], ...],      // related events in trace
  "related_events": [MemoryEvent[], ...]  // other ops on same key
}
```

### Archives

**List Archives**
```
GET /api/archives?key_pattern=<glob>&start=<iso>&limit=50

Response: 200 OK
{
  "archives": [ArchiveEntry[], ...],
  "total": 5000,
  "limit": 50
}
```

**Restore Archive**
```
POST /api/archives/:id/restore
Authorization: Bearer <token>
Content-Type: application/json

{
  "force": false  // overwrite if exists
}

Response: 200 OK
{
  "success": true,
  "restored_at": "2026-06-20T10:30:00Z",
  "memory_key": "..."
}
```

### Stats

**Get Memory Stats**
```
GET /api/stats?interval=<15m|1h|1d>

Response: 200 OK
{
  "current": MemoryStats,
  "history": [MemoryStats[], ...]  // last N samples
}
```

### Retention

**Get Policy**
```
GET /api/retention/policy

Response: 200 OK
{
  "policy": {
    "max_age_days": 30,
    "max_size_bytes": 1000000000,
    "recompression_guard": true,
    "keep_patterns": ["*:critical:*"],
    "version": "2.0",
    "updated_at": "2026-06-15T10:00:00Z"
  }
}
```

**Update Policy (service account only)**
```
PUT /api/retention/policy
Authorization: Bearer <token>
Content-Type: application/json

{
  "max_age_days": 45,
  "max_size_bytes": 2000000000,
  "keep_patterns": ["*:critical:*", "*:audit:*"]
}

Response: 200 OK
{
  "success": true,
  "policy": {...},
  "audit_log_id": "audit_20260620_001"
}
```

### Audit

**Get Audit Log**
```
GET /api/audit?operation=<restore|policy_update>&limit=100

Response: 200 OK
{
  "entries": [
    {
      "timestamp": "2026-06-20T10:30:00Z",
      "operation": "restore",
      "target": "memory:key:123",
      "requester": "service-account",
      "result": "success"
    },
    ...
  ]
}
```

---

## Testing

### Backend Tests (60 tests, 85%+ coverage)

**Files:**
- `__tests__/api/events.test.ts` (20 tests)
  - Query with filters (date range, operation, agent)
  - Pagination
  - Fulltext search
  - Error handling (no results, invalid filter)

- `__tests__/api/archives.test.ts` (15 tests)
  - List archives
  - Restore (success, already_exists, corrupted)
  - Restore audit logging
  - Error handling

- `__tests__/api/stats.test.ts` (15 tests)
  - Metrics aggregation (correctness)
  - Latency percentiles
  - Compression ratio calculation
  - Performance (<100ms)

- `__tests__/api/retention.test.ts` (10 tests)
  - Get current policy
  - Update policy (valid, invalid)
  - Policy validation
  - Audit logging

### Frontend Tests (50 tests, 80%+ coverage)

**Files:**
- `__tests__/pages/EventBrowser.test.tsx` (20 tests)
  - Render search + table
  - Filter behavior
  - Pagination
  - Click → detail view
  - Loading/error states

- `__tests__/pages/ArchiveManager.test.tsx` (15 tests)
  - List archives
  - Restore button + confirm dialog
  - Restore success/failure
  - Loading states

- `__tests__/pages/StatsDashboard.test.tsx` (15 tests)
  - Charts render correctly
  - Data loading
  - Responsive layout
  - Error fallback

---

## Metrics & Observability

### Prometheus Metrics

```
memory_explorer_event_query_duration_seconds{operation="search",status="success"}
memory_explorer_event_query_total{operation="search",status="success|failure"}
memory_explorer_archive_restore_total{status="success|failure|error"}
memory_explorer_stats_calculation_duration_seconds
memory_explorer_api_response_duration_seconds{endpoint="/events",method="GET"}
```

### Loki Logs

```
{job="memory-explorer"} |= "event_query" | json
{job="memory-explorer"} |= "archive_restore" | json
{job="memory-explorer"} |= "policy_update" | json
```

### Grafana Dashboard (`observability/dashboards/memory-explorer.json`)

- Event query latency (p50/p95/p99)
- Archive restore success rate
- Stats calculation time
- Auth errors (403, token invalid)
- Memory usage of UI service

---

## Compliance & Security

### RBAC

- **Public (read-only)**: Event browser, archive list, stats, retention policy view
- **Service account (write)**: Archive restore, policy update
- **Audit log**: all operations logged with timestamp, actor, result

### Audit Trail

Every write operation recorded:
```
{
  "timestamp": ISO8601,
  "operation": "archive_restore|policy_update",
  "actor": "service-account|<api-key>",
  "target": "archive:key:...|policy",
  "result": "success|failure",
  "error": null,
  "metadata": {...}
}
```

---

## Deployment

### Docker

```dockerfile
# Dockerfile.memory-explorer
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3000
ENV MEMORY_EXPLORER_SERVICE_TOKEN=${MEMORY_EXPLORER_SERVICE_TOKEN}
ENV MEMORY_STORE_URL=http://memory-store:5432
CMD ["node", "dist/server.js"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: memory-explorer
spec:
  replicas: 2
  selector:
    matchLabels:
      app: memory-explorer
  template:
    metadata:
      labels:
        app: memory-explorer
    spec:
      containers:
      - name: memory-explorer
        image: cic:memory-explorer-1.0.0
        ports:
        - containerPort: 3000
        env:
        - name: MEMORY_EXPLORER_SERVICE_TOKEN
          valueFrom:
            secretKeyRef:
              name: memory-explorer
              key: service_token
        - name: MEMORY_STORE_URL
          value: http://memory-store:5432
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
```

### Environment Variables

```
MEMORY_EXPLORER_SERVICE_TOKEN=<random-64-char-token>
MEMORY_STORE_URL=http://memory-store:5432
MEMORY_EXPLORER_PORT=3000
LOG_LEVEL=info
```

---

## Acceptance Criteria

- ✅ Event browser searches 10k+ events in <100ms
- ✅ Archive restore works end-to-end with audit logging
- ✅ Stats dashboard renders within 2s of load
- ✅ Policy update reflected in MemoryStore within 5s
- ✅ RBAC enforced (write ops require token)
- ✅ All operations logged to audit trail
- ✅ 85%+ test coverage (backend), 80%+ (frontend)
- ✅ Prometheus metrics exported
- ✅ Grafana dashboard provisioned
- ✅ Docker image builds and runs
- ✅ K8s deployment stable (no CrashLoopBackOff)
- ✅ Documentation complete (user guide, API docs, runbook)

---

## Timeline

| Week | Tasks | Status |
|------|-------|--------|
| 1 (Jun 14–21) | Backend API, auth, tests | — |
| 2 (Jun 21–28) | Frontend, integration, deployment, docs | — |

---

## Files Checklist

### Backend
- [ ] `src/memory-explorer/api/events.ts` (150 lines)
- [ ] `src/memory-explorer/api/archives.ts` (120 lines)
- [ ] `src/memory-explorer/api/stats.ts` (180 lines)
- [ ] `src/memory-explorer/api/retention.ts` (100 lines)
- [ ] `src/memory-explorer/api/auth.ts` (40 lines)
- [ ] `src/memory-explorer/server.ts` (50 lines)
- [ ] `src/memory-explorer/__tests__/api.test.ts` (600 lines)

### Frontend
- [ ] `src/memory-explorer/ui/pages/EventBrowser.tsx` (250 lines)
- [ ] `src/memory-explorer/ui/pages/ArchiveManager.tsx` (200 lines)
- [ ] `src/memory-explorer/ui/pages/StatsDashboard.tsx` (300 lines)
- [ ] `src/memory-explorer/ui/pages/RetentionPolicy.tsx` (150 lines)
- [ ] `src/memory-explorer/ui/components/SearchBar.tsx` (80 lines)
- [ ] `src/memory-explorer/ui/components/ResultsTable.tsx` (120 lines)
- [ ] `src/memory-explorer/ui/components/EventDetail.tsx` (200 lines)
- [ ] `src/memory-explorer/ui/hooks/useEvents.ts` (60 lines)
- [ ] `src/memory-explorer/ui/hooks/useStats.ts` (50 lines)
- [ ] `src/memory-explorer/ui/__tests__/pages.test.tsx` (600 lines)

### Config & Deployment
- [ ] `docker/Dockerfile.memory-explorer`
- [ ] `k3d/kustomization.yaml`
- [ ] `observability/dashboards/memory-explorer.json`
- [ ] `docs/MEMORY_EXPLORER.md` (user guide)
- [ ] `.env.example` (env variables)

**Total:** 20 files, ~4200 lines code + tests

---

## Success Metrics

- **Event query latency**: p95 < 100ms
- **Archive restore success rate**: > 99%
- **UI page load time**: < 2s (stats), < 1s (event browser)
- **Test coverage**: backend 85%+, frontend 80%+
- **Deployment**: 0 CrashLoopBackOff, 99.5% availability
- **Audit compliance**: 100% of write ops logged

---

## Notes

- Reuse MemoryStore Query API (Phase 23.4) for event queries
- Compress archives on restore (use Retention distiller logic from 23.5)
- Public read; write behind service account token (not OAuth, keep simple)
- Charts use historical data aggregated by stats service (not real-time PromQL)
- Lineage visualization: D3 or Cytoscape for dependency graph

---

## Links

- **MemoryStore (Phase 23.2):** `/Phase-23-2-MemoryStore.md`
- **Query API (Phase 23.4):** `/Phase-23-4-MemoryQuery.md`
- **Retention (Phase 23.5):** `/Phase-23-5-MemoryRetention.md`
- **GitHub:** [sorensencc-dotcom/CIC](https://github.com/sorensencc-dotcom/CIC)
