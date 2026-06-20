# Phase 4 Execution Checklist

**Version:** 1.0.0  
**Status:** Ready  
**Updated:** 2026-06-20

## Pre-Execution

- [ ] Phase 2/3 fully merged to master
- [ ] All 374 tests passing
- [ ] Planning server running on port 3114
- [ ] WarmPool size set to 3 (default)
- [ ] Monitoring stack available (Prometheus, Grafana, PagerDuty)

---

## Week 1: Load Testing Infrastructure

### Day 1-2: Environment Setup

**Tasks:**
- [ ] Set up k6 environment
  - [ ] Install k6 CLI
  - [ ] Install k6-prometheus plugin
  - [ ] Test k6 → Prometheus connectivity
- [ ] Configure load test URLs
  - [ ] Prepare test URLs (simple, SPA, slow)
  - [ ] Set up test data fixtures
  - [ ] Document URL categories (framework, complexity)
- [ ] Prepare monitoring stack
  - [ ] Enable Prometheus scraping on /metrics
  - [ ] Verify Grafana can read Prometheus
  - [ ] Test alert webhook integration

**Validation:**
- [ ] k6 can emit metrics to Prometheus
- [ ] Prometheus scrapes localhost:3114/metrics
- [ ] Grafana dashboard loads (empty panels OK)

### Day 3-4: Load Test Scripts (k6)

**Scenario 1: Baseline Throughput (1 req/sec, 5 min)**

```javascript
// phase4_baseline.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 1 },
    { duration: '3m', target: 1 },
    { duration: '1m', target: 0 },
  ],
};

export default function () {
  const res = http.post('http://localhost:3114/navigate', {
    url: 'https://example.com',
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 3000ms': (r) => r.timings.duration < 3000,
  });
}
```

**Scenario 2: Saturation Ramp (1 → 10 req/sec, 10 min)**

```javascript
// phase4_saturation.js
export const options = {
  stages: [
    { duration: '1m', target: 1 },
    { duration: '1m', target: 2 },
    { duration: '1m', target: 4 },
    { duration: '1m', target: 6 },
    { duration: '1m', target: 8 },
    { duration: '1m', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '1m', target: 0 },
  ],
};
// ... rest same as baseline
```

**Scenario 3: TTL Expiration (5 min wait, then 5 req/sec ramp)**

```javascript
// phase4_ttl.js
export const options = {
  stages: [
    { duration: '5m', target: 0 }, // Wait for TTL
    { duration: '1m', target: 5 }, // Ramp up during expiry
    { duration: '1m', target: 0 },
  ],
};
```

**Scenario 4: Hydration Stress (100% SPA URLs)**

```javascript
// phase4_hydration.js
const spaUrls = [
  'https://example.com',
  'https://another-spa.com',
  'https://spa3.com',
];

export default function () {
  const url = spaUrls[Math.floor(Math.random() * spaUrls.length)];
  const res = http.post('http://localhost:3114/navigate', {
    url,
  });

  check(res, {
    'hydration score >= 70': (r) => {
      const data = JSON.parse(r.body);
      return data.hydrationScore >= 70;
    },
  });
}
```

**Scenario 5: WAF Simulation (5% failures)**

```javascript
// phase4_waf.js
export default function () {
  const isFail = Math.random() < 0.05;
  const url = isFail
    ? 'https://blocked-by-waf.example.com'
    : 'https://example.com';

  const res = http.post('http://localhost:3114/navigate', {
    url,
    retryCount: 2,
  });

  check(res, {
    'response received': (r) => r.status !== 0,
  });
}
```

**Scenario 6: Vertical Drift (Simulated via URL failure)**

```javascript
// phase4_drift.js
export default function () {
  const verticals = ['news', 'blog', 'commerce'];
  const vertical = verticals[__VU % 3];

  const isFail = vertical === 'news' && Math.random() < 0.2;
  const url = isFail
    ? 'https://news-broken.example.com'
    : `https://${vertical}.example.com`;

  const res = http.post('http://localhost:3114/navigate', {
    url,
  });

  check(res, {
    'response ok': (r) => r.status === 200,
  }, { vertical });
}
```

**Deliverables:**
- [ ] 6 k6 scripts in `load-tests/`
- [ ] Each script passes local dry-run
- [ ] Scripts export Prometheus metrics

### Day 5: Baseline Run

**Tasks:**
- [ ] Run Scenario 1 (Baseline) with monitoring
  - [ ] Capture latency histogram
  - [ ] Capture retry distribution
  - [ ] Capture warm-pool metrics
  - [ ] Log baseline thresholds

**Validation:**
- [ ] Latency p95 ≤ 3.5s
- [ ] Success rate ≥ 95%
- [ ] Metrics flowing to Prometheus

---

## Week 2: Monitoring & Alerting

### Day 1-2: Grafana Dashboards

**8 Panels:**

1. **Latency Overview** (multi-series line)
   - Y: latency (ms)
   - Series: p50, p95, p99
   - Window: 5m

2. **Success Rate** (gauge + sparkline)
   - Value: success_rate
   - Target: 95%
   - Trend: 24h

3. **Throughput** (bar chart)
   - Y: requests/sec
   - X: time
   - Window: 5m

4. **WarmPool Health** (table)
   - Columns: poolSize, healthyCount, unhealthyCount, avgLatency
   - Auto-refresh: 10s

5. **Retry Distribution** (pie chart)
   - Slices: success, transient, waf, structural
   - Refresh: 1m

6. **Hydration Scores** (histogram)
   - X: score (0-100)
   - Y: frequency
   - Bins: 10

7. **Vertical Drift** (heatmap)
   - X: time
   - Y: vertical
   - Color: drift_percent
   - Window: 24h

8. **Alert Status** (table)
   - Columns: alert, severity, status, lastTriggered
   - Auto-refresh: 1m

**Deliverables:**
- [ ] 8 panels created + tested
- [ ] Dashboard JSON exported
- [ ] Panels display baseline data

### Day 3-4: Alert Rules (Prometheus)

**Rules File: `prometheus/phase4_alerts.yml`**

```yaml
groups:
  - name: phase4_alerts
    rules:
      # Latency
      - alert: HighLatencyWarning
        expr: histogram_quantile(0.95, navigate_latency_ms) > 3000
        for: 5m
        
      - alert: HighLatencyCritical
        expr: histogram_quantile(0.95, navigate_latency_ms) > 5000
        for: 2m

      # Success Rate
      - alert: LowSuccessRateWarning
        expr: navigate_success_rate < 0.90
        for: 5m
        
      - alert: LowSuccessRateCritical
        expr: navigate_success_rate < 0.80
        for: 2m

      # WarmPool
      - alert: UnhealthySessionsWarning
        expr: warm_pool_unhealthy_count > 1
        for: 1m
        
      - alert: PoolStarvation
        expr: warm_pool_size < warm_pool_target
        for: 30s

      # Retry
      - alert: HighRetryRate
        expr: retry_count_total / navigate_count_total > 0.2
        for: 5m
        
      - alert: HighFinalFailureRate
        expr: retry_final_failure_count / retry_count_total > 0.05
        for: 5m

      # Hydration
      - alert: LowHydrationScore
        expr: histogram_quantile(0.5, hydration_score) < 60
        for: 5m

      # Drift
      - alert: VerticalDriftWarning
        expr: vertical_drift_percent >= 10
        for: 5m
        
      - alert: VerticalDriftCritical
        expr: vertical_drift_percent >= 20
        for: 2m

      # WAF
      - alert: WAFBlockSpike
        expr: waf_block_rate > 0.005
        for: 5m
```

**Deliverables:**
- [ ] 18 alert rules defined
- [ ] Rules tested in Prometheus UI
- [ ] Alert routing configured (PagerDuty/Slack)

### Day 5: Alert Testing

**Tasks:**
- [ ] Fire each alert type manually (override metrics)
- [ ] Verify PagerDuty/Slack notification
- [ ] Verify on-call escalation
- [ ] Document alert runbooks

**Deliverables:**
- [ ] All 18 alerts firing + routing correctly
- [ ] Runbooks created for each alert (3 pages)

---

## Week 3: Stress Testing & Tuning

### Day 1-2: Full Scenario Runs

**Run all 6 scenarios in sequence:**

- [ ] Scenario 1: Baseline (capture baseline metrics)
- [ ] Scenario 2: Saturation Ramp (identify saturation point)
- [ ] Scenario 3: TTL Expiration (validate recovery)
- [ ] Scenario 4: Hydration Stress (validate SPA handling)
- [ ] Scenario 5: WAF Simulation (validate error classification)
- [ ] Scenario 6: Vertical Drift (validate drift detection)

**For Each Scenario:**
- [ ] Capture metrics (latency, success, retry, drift)
- [ ] Verify alerts fire correctly
- [ ] Check warm-pool recycle behavior
- [ ] Log any anomalies

**Deliverables:**
- [ ] Scenario results (JSON)
- [ ] Comparison to thresholds (pass/fail)
- [ ] Tuning recommendations (if needed)

### Day 3: Client SLA & Integration Guide

**SLA Document:**
- [ ] Availability SLO: 99.5%
- [ ] Latency SLO: p95 ≤ 3.5s
- [ ] Hydration SLO: score ≥ 70 for 90%
- [ ] Retry SLO: ≤ 5% of requests
- [ ] Exclusions (4xx errors, etc.)

**Integration Guide:**
- [ ] Endpoint overview
- [ ] Request/response examples
- [ ] Error handling (error taxonomy)
- [ ] Rate limiting policy
- [ ] Retry strategy recommendation
- [ ] Monitoring integration (push metrics)

**Deliverables:**
- [ ] SLA document (PDF + MD)
- [ ] Integration guide (PDF + MD)
- [ ] Example client code (curl, Python, Node.js)

### Day 4-5: Documentation & Sign-Off

**Tasks:**
- [ ] Phase 4 execution report
  - [ ] Scenario results + analysis
  - [ ] Threshold pass/fail
  - [ ] Bottleneck identification
  - [ ] Tuning recommendations
  - [ ] Future work (Phase 5+)

- [ ] Architecture documentation
  - [ ] Metrics schema
  - [ ] Alert routing
  - [ ] Dashboard design
  - [ ] Operator runbook

- [ ] Stakeholder presentations
  - [ ] Engineering lead review
  - [ ] SRE/ops review
  - [ ] Product owner review
  - [ ] Client stakeholder review

**Deliverables:**
- [ ] Phase 4 execution report (10 pages)
- [ ] Architecture guide (8 pages)
- [ ] Sign-off from all stakeholders

---

## Success Criteria (Go/No-Go)

**Must All Pass:**
- [ ] Median latency ≤ 2.0s
- [ ] P95 latency ≤ 3.5s
- [ ] Success rate ≥ 95%
- [ ] Saturation point ≥ 4 req/sec
- [ ] No memory leaks (24h soak)
- [ ] All 18 metrics exported
- [ ] All 8 dashboards live
- [ ] All 18 alerts functional
- [ ] Client SLA signed
- [ ] Integration guide complete

**Go Decision:** All criteria pass → Ready for Phase 5 (persistent metrics, distributed pooling)

---

## Rollback Plan

If any criteria fail:

1. **Latency miss:** Investigate SPA heuristics, profile bottleneck
2. **Success rate miss:** Investigate retry logic, check transient error classification
3. **Saturation low:** Increase WarmPool size, optimize checkout contention
4. **Alert failures:** Review Prometheus rules, check alert routing
5. **Metric gaps:** Add missing metrics, update Prometheus config

**Recovery:** Fix identified issue, re-run scenario, re-validate

---
