# Phase 4 PRD: Load Testing + Monitoring + Client Guarantees

**Version:** 1.0.0  
**Status:** Locked  
**Updated:** 2026-06-20

## Executive Summary

Phase 4 validates the ingestion engine under production-like load, wires observability into the monitoring stack, and establishes client-facing SLOs for the planning API.

**Deliverables:**
1. Load test plan (6 scenarios, pass/fail thresholds)
2. Metrics-to-alerts mapping (18 alerts, 3 severity levels)
3. Load test implementation (k6 + Artillery scripts)
4. Dashboard panel specs (Grafana/Prometheus)
5. Client SLA documentation

**Timeline:** 5-7 days  
**Effort:** 120-160 hours  
**Dependencies:** Phase 2/3 complete (✅)

---

## 1. Goals

### 1.1 Performance Validation
- Identify WarmPool saturation point
- Establish latency SLOs (p50, p95, p99)
- Validate retry behavior under load
- Profile hydration detector under stress

**Success Criteria:**
- Median latency ≤ 2.0s
- P95 latency ≤ 3.5s
- Success rate ≥ 95%
- Saturation point ≥ 4 req/sec

### 1.2 Stability Validation
- Validate session TTL expiration handling
- Validate concurrent checkout contention
- Validate health check interval
- Validate graceful degradation

**Success Criteria:**
- No memory leaks (24-hour soak test)
- No session orphaning
- No metrics loss on restart
- Healthy recycle rate ≤ 1 session/min

### 1.3 Observability Integration
- Wire metrics into Prometheus
- Create Grafana dashboards
- Configure alerting (PagerDuty/Slack)
- Establish monitoring SLOs

**Success Criteria:**
- All 18 metrics exported
- 8 dashboard panels live
- Alert testing passes
- Drift detection < 60s

### 1.4 Client Guarantees
- Document SLOs for `/navigate` and `/sample`
- Publish error taxonomy
- Create client integration guide
- Publish rate limiting policy

**Success Criteria:**
- SLO doc signed off
- Error codes documented
- Integration examples working
- Rate limits enforced

---

## 2. Scope

### 2.1 In Scope
- Load test plan + scenarios
- Load test implementation (k6)
- Metrics collection + export
- Grafana dashboard (8 panels)
- Alert definitions (18 alerts)
- Client SLA document
- Integration guide with examples

### 2.2 Out of Scope
- Distributed pooling (Phase 5)
- Persistent metrics (Phase 5)
- Session caching (Phase 5)
- Advanced retry strategies (Phase 6)
- Custom framework plugins (Phase 7)

---

## 3. Scenarios

### 3.1 Baseline Throughput
- Load: 1 req/sec for 5 min
- Expected: stable latency, ≤ 5% retries

### 3.2 Saturation Ramp
- Ramp 1 → 10 req/sec over 10 min
- Expected: saturation at 4-6 req/sec

### 3.3 TTL Expiration Storm
- Force 5-min TTL expiry, ramp to 5 req/sec
- Expected: respawn within 2s, latency spike ≤ 500ms

### 3.4 Hydration Stress
- 100% SPA URLs, 3 req/sec for 5 min
- Expected: hydration score ≥ 70 for ≥ 90%

### 3.5 WAF Simulation
- Inject 5% WAF blocks
- Expected: correct classification, no pool recycling

### 3.6 Vertical Drift
- Drop success rate by 20% for one vertical
- Expected: drift alert < 60s

---

## 4. Metrics to Export

**WarmPool:**
- `warm_pool_size` (gauge)
- `warm_pool_healthy_count` (gauge)
- `warm_pool_unhealthy_count` (gauge)
- `warm_pool_avg_latency_ms` (gauge)
- `warm_pool_checkout_count` (counter)
- `warm_pool_checkin_count` (counter)
- `warm_pool_recycle_count` (counter)

**Navigation:**
- `navigate_latency_ms` (histogram: p50, p95, p99)
- `navigate_success_rate` (gauge)
- `navigate_hydration_score` (histogram)

**Retry:**
- `retry_count` (counter, labeled by reason)
- `retry_final_failure_count` (counter)

**Drift:**
- `vertical_drift_percent` (gauge, per vertical)
- `drift_detection_latency_s` (histogram)

---

## 5. Alerts

### 5.1 Critical
- `warm_pool.unhealthy_count > 1`
- `navigate.latency_p95 > 5000ms` (2 min)
- `success_rate < 80%` (2 min)
- `vertical.drift_percent >= 20%`

### 5.2 Warning
- `navigate.latency_p95 > 3000ms` (5 min)
- `success_rate < 90%` (5 min)
- `retry.count > 20%`
- `retry.final_failure > 5%`
- `warm_pool.size < targetSize` (30s)
- `hydration.score_avg < 60`
- `vertical.drift_percent >= 10%`
- `waf_block_rate > 0.5%`

### 5.3 Info
- Pool recycle event
- Health check completion
- Session creation/destruction

---

## 6. Dashboard Panels

1. **Latency Overview** (line chart: p50, p95, p99)
2. **Success Rate** (gauge + sparkline)
3. **Throughput** (bar chart: req/sec)
4. **WarmPool Health** (table: size, healthy, unhealthy)
5. **Retry Distribution** (pie: success, transient, waf, structural)
6. **Hydration Scores** (histogram)
7. **Vertical Drift** (heatmap: vertical × time)
8. **Alert Status** (table: alert, severity, status)

---

## 7. Client SLOs

### 7.1 Availability
- Target: 99.5% uptime
- Measurement: successful responses / total requests
- Exclusions: client 4xx errors

### 7.2 Latency
- Target: p95 ≤ 3.5s
- Measurement: request → response time
- Includes: navigation + hydration + screenshot

### 7.3 Retry Rate
- Target: ≤ 5% of requests
- Measurement: retry.count / total
- Success: final response after retries

### 7.4 Hydration
- Target: score ≥ 70 for 90% of requests
- Measurement: hydration.score distribution
- Scope: SPA-capable verticals only

---

## 8. Error Taxonomy

**Transient (Retriable):**
- Network timeout
- DNS resolution
- Connection refused
- Page crash (recoverable)

**Permanent (Non-retriable):**
- Invalid URL
- SSL/TLS error
- Authentication failure
- 4xx HTTP errors

**External (WAF/Block):**
- 403 Forbidden
- 429 Rate limited
- CAPTCHA challenge
- IP blocked

**Drift (Investigable):**
- Hydration timeout
- Structural change
- Framework version mismatch
- Content unavailable

---

## 9. Rate Limiting

**Default:** 100 req/min per client (IP)  
**Burst:** 10 req/sec  
**Backoff:** exponential, 5min window  
**Exemptions:** internal clients (auth required)

---

## 10. Implementation Checklist

- [ ] Load test environment setup
- [ ] k6 scripts (6 scenarios)
- [ ] Prometheus scrape config
- [ ] Grafana dashboards (8 panels)
- [ ] Alert rules (18 alerts)
- [ ] Client SLA document
- [ ] Integration guide + examples
- [ ] Load test baseline run
- [ ] Metrics validation
- [ ] Alert testing
- [ ] Documentation review
- [ ] Stakeholder sign-off

---

## 11. Success Criteria

**All Must Pass:**
1. Median latency ≤ 2.0s
2. P95 latency ≤ 3.5s
3. Success rate ≥ 95%
4. Saturation ≥ 4 req/sec
5. No memory leaks (24h)
6. All 18 metrics exported
7. All 8 dashboard panels live
8. All 18 alerts functional
9. Client SLA document signed
10. Integration guide complete

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Load test saturation < 3 req/sec | Can't scale | Increase WarmPool size, optimize retry |
| High latency variance | SLO miss | Profile SPA heuristics, optimize detection |
| Alert noise | On-call fatigue | Tune thresholds, add deduplication |
| Metrics explosion | Dashboard clutter | Limit to 18 core metrics, aggregate |

---

## 13. Timeline

**Week 1:**
- Day 1-2: Load test environment + k6 scripts
- Day 3-4: Load test scenarios + baseline run
- Day 5: Metrics validation + Prometheus setup

**Week 2:**
- Day 1-2: Grafana dashboards (8 panels)
- Day 3-4: Alert rules + PagerDuty integration
- Day 5: Client SLA + integration guide

**Week 3:**
- Day 1-2: Stress testing + tuning
- Day 3: Documentation review
- Day 4-5: Stakeholder sign-off + handoff

---

## 14. Sign-Off

- [ ] Engineering Lead
- [ ] SRE/Ops
- [ ] Product Owner
- [ ] Client Stakeholder

---
