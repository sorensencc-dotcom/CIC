# Phase 2 Architecture: Ingestion Hardening

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Planning Engine Server                  │
│                   (Port 3114, Express)                   │
│                                                           │
│  /navigate → CloakBrowserAdapterWithWarmPool            │
│  /sample   →    ↓                                        │
│  /metrics  →  WarmPoolManager (3 sessions)              │
│  /cleanup  →    ├─ SpaHydrationDetector                 │
│                 ├─ DomSampler                           │
│                 └─ VerticalDriftDetector                │
└─────────────────────────────────────────────────────────┘
         ↓
   Browser Sessions (Puppeteer)
   - Navigate, screenshot, DOM extract
   - Health checks every 30s
   - Recycle after 5 min or 50 navigations
```

## Component Hierarchy

### 1. WarmPoolManager (Core)

**Responsibility:** Session lifecycle management

**Public API:**
- `init()` - spawn initial pool
- `checkout(timeoutMs)` - get healthy session
- `checkin(session)` - return session to pool
- `recordNavigation(session, latencyMs, success)` - update metrics
- `getMetrics()` - pool stats
- `drain()` - cleanup all
- `startHealthCheck()` - periodic maintenance

**Internal State:**
- `pool: WarmPoolSession[]` - active sessions
- `waitingList: Function[]` - blocked checkout callers
- `metrics` - counters for observability

**Health Check (30s interval):**
1. Find old sessions (> 5 min old)
2. Find unresponsive sessions (test newPage → goto about:blank)
3. Close + recycle + spawn replacements
4. Log results

**Session Validity:**
```
healthy = true AND
  age < 5 min AND
  navigationCount < 50 AND
  errorCount < 3
```

### 2. SpaHydrationDetector

**Responsibility:** Framework detection + stability scoring

**Algorithm:**
1. Detect framework markers in page:
   - React: `__REACT_VERSION__`, `__REACT_ROOT__`
   - Webflow: `.w-site`, webflow scripts
   - Framer: `__framer_preview_id__`
   - Wix: `self.__wixBalmEmbed`

2. Observe mutations with listener:
   - Collect mutation count
   - Track node count delta
   - Run until: 100ms without mutations OR 1.5s timeout

3. Score calculation:
   ```
   score = 40 * framework_match
         + 30 * stability_factor
         + 20 * mutation_score
         + 10 * node_delta_score
   
   healthy = score >= 40
   ```

**Output:**
```typescript
{
  score: 0-100,
  framework: 'react' | 'webflow' | 'framer' | 'wix' | 'unknown',
  healthy: boolean,
  timeMs: number,
  signals: {
    reactNextMarkers: boolean,
    mutationCount: number,
    nodeCountDeltaPercent: number,
    stabilityAchieved: boolean
  }
}
```

### 3. DomSampler

**Responsibility:** Multi-URL sampling + completeness scoring

**Algorithm:**
1. Try URLs in order: `/`, `/home`, `/services`
2. For each:
   - Navigate
   - Extract DOM
   - Score completeness: `(nodeCount + textDensity + imageCount + linkCount) / 4`
3. Filter scores < 20 (too sparse)
4. Select highest, fallback to best available

**Completeness Score:**
```
base = min(nodeCount / 3000, 1.0) * 40
     + textDensity * 30  (0.0-1.0)
     + min(imageCount / 10, 1.0) * 15
     + min(linkCount / 25, 1.0) * 15
```

**Output:**
```typescript
{
  url: string,
  completenessScore: number,
  dom: string,
  hydrationScore: number
}
```

### 4. VerticalDriftDetector

**Responsibility:** Post-navigation drift classification

**Drift Types (Priority):**
1. **Hydration Drift:** Hydration score < 40 (framework loading issue)
2. **Transient Drift:** Intermittent failures (network, timing)
3. **WAF Drift:** Block/challenge pages (IP reputation)
4. **Structural Drift:** Site structure changes

**Severity:**
- Critical: drift signal >= 20% of samples
- Warning: drift signal >= 10% of samples

**Recommendations:**
- Hydration: check framework updates, retry with longer timeout
- Transient: increase retries, add backoff
- WAF: rotate IP, add delay, verify user-agent
- Structural: check if site layout changed

### 5. CloakBrowserAdapterWithWarmPool

**Responsibility:** Coordinate components, expose high-level API

**Public API:**
- `init()` - initialize adapter (warm pool + detectors)
- `navigate(url, options)` - single navigation with retries
- `sampleUrls(baseUrl)` - multi-URL sampling
- `getWarmPoolMetrics()` - metrics
- `cleanup()` - shutdown

**Navigate Flow:**
```
1. Loop with retries:
   a. Checkout session (wait up to timeoutMs)
   b. Create page
   c. Navigate to URL
   d. Detect hydration
   e. Extract DOM + screenshot
   f. Record success + checkin
   
   On error:
   a. Record failure
   b. Checkin (triggers recycle if unhealthy)
   c. Exponential backoff
   d. Retry (up to maxRetries)
```

## Data Flow

### Navigate Request

```
POST /navigate
  ↓
adapter.navigate(url)
  ↓
warmPool.checkout(10s timeout)
  ├─ If pool empty: wait on waitingList
  └─ Return session
  ↓
session.browser.newPage()
  ↓
page.goto(url, { waitUntil: 'domContentLoaded' })
  ↓
hydrationDetector.detect(page)
  ├─ Detect framework
  ├─ Observe mutations (100ms-1.5s)
  └─ Score 0-100
  ↓
page.evaluate(() => document.documentElement.outerHTML)
  ↓
page.screenshot({ fullPage: true })
  ↓
warmPool.recordNavigation(session, latencyMs, true)
  ├─ Increment counters
  ├─ Store latency (keep last 10)
  └─ Mark unhealthy if >3 errors or >50 navs
  ↓
warmPool.checkin(session)
  ├─ If unhealthy: close + spawn replacement
  └─ Else: return to pool
  ↓
Return { dom, hydrationScore, latencyMs, screenshot }
```

### Health Check (30s)

```
Timer fires every 30s
  ↓
For each session in pool:
  ├─ If age > 5 min: mark for removal
  └─ Else: test responsiveness
      └─ newPage → goto about:blank → close
  ↓
Remove old/unresponsive sessions
  ├─ Close browsers
  ├─ Increment recycleCount
  └─ Spawn replacement if pool < targetSize
  ↓
Log metrics if any removed
```

## Metrics & Observability

**Counters (cumulative):**
- `spawnCount` - total sessions created
- `checkoutCount` - total checkouts
- `checkinCount` - total checkins
- `recycleCount` - total session recycles
- `totalNavigations` - successful navigations

**Gauges (current state):**
- `poolSize` - sessions in pool now
- `healthySessionCount` - healthy sessions in pool
- `unhealthySessionCount` - unhealthy sessions in pool

**Histograms:**
- `avgLatencyMs` - average navigation time (rounded)
- `latencyMs[]` - per-session latency history (last 10)

**Logging:**
- JSON structured logs with event + context
- Levels: INFO, WARN, ERROR
- Events: `spa.hydration.*`, `warm_pool.*`, `adapter.*`

## Error Handling

**Graceful Degradation:**

1. **Page navigate fails** → recordNavigation(false) + checkin + retry
2. **Hydration detection fails** → return score=0, healthy=false
3. **Screenshot fails** → return with empty buffer, continue
4. **Session checkout timeout** → throw error, client retries
5. **Health check fail** → log error, continue
6. **Browser crash** → mark unhealthy + recycle on checkin

**Retry Strategy:**

```
for attempt in 0..maxRetries:
  try:
    navigate()
    return result
  except:
    if attempt < maxRetries:
      wait backoff(attempt)  // 100ms * 2^attempt, capped 5s
      continue
    else:
      throw error
```

## Testing Strategy

**Unit Tests:**
- Framework detection (React, Webflow, Framer, Wix)
- Mutation observer behavior
- Hydration scoring edge cases
- DOM sampling fallbacks
- Drift classification logic
- Checkout/checkin state transitions

**Integration Tests:**
- Full navigate flow with mock browser
- Multi-URL sampling
- Health check interval + recycling
- Concurrent checkouts
- Error recovery with retries
- Metrics accumulation

**Test Results:**
- SpaHydrationDetector: 9/9
- DomSampler: 13/13
- WarmPoolManager: 30/30
- Total: 52/52 ✅

## Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Session spawn | 500-2000ms | Browser startup |
| Navigate (simple page) | 500-1000ms | DOM load only |
| Navigate (complex page) | 1000-3000ms | Hydration detection |
| Hydration detection | 100-1500ms | Mutation observation |
| Health check | 1-5s | All sessions tested serially |
| Screenshot | 200-500ms | Full page render |

**Throughput:**
- Pool size 3: ~3-5 requests/sec (with retries)
- Pool size 10: ~10-15 requests/sec
- Bottleneck: browser session startup (not I/O)

## Future Enhancements

1. **Persistent metrics** (Redis/InfluxDB)
2. **Session pooling by URL** (cache DOM for repeat URLs)
3. **Drift detection integration** (post-nav analysis)
4. **Distributed pooling** (multi-process/machine)
5. **Custom frameworks** (pluggable detectors)
6. **Performance profiling** (per-component timing)
7. **Screenshot optimization** (JPEG, WebP, compression)
8. **Rate limiting** (per-client token bucket)
