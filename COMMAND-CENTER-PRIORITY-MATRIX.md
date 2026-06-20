# CIC Command Center — Priority Matrix

**Scope:** All major systems (Governance, Memory, Autonomy, TorqueQuery, Extractors, Skills, ARL)  
**Ranking:** Operational criticality × Impact scope × Visibility gap  

---

## TIER 1: CRITICAL (Add Immediately)

### 1. **Autonomy Loop Health** (Phases 23–27)
- **Components:** Memory→Skill Graph→Planner→Orchestrator→Knowledge Graph
- **Panels:**
  - Agent heartbeat + uptime (Foreman, Planner, Harvester, Auditor, Archivist, Optimizer, EvolutionAgent)
  - Phase state transitions (23→24→25→26→27) — latency, errors
  - Memory ingest rate (items/sec) + throughput (bytes/sec)
  - Skill graph query latency (p50/p95/p99)
  - Planner decision time (reasoning loop duration)
  - Orchestrator execution rate (tasks/min) + success rate
  - Knowledge graph update latency

- **Why critical:** entire autonomy stack depends on this; single point of failure for agent execution

- **Metrics needed:**
  ```
  agent_heartbeat_timestamp{agent_id=foreman|planner|harvester|auditor|archivist|optimizer|evolution}
  phase_transition_duration_seconds{from_phase=X, to_phase=Y, status=success|failure}
  memory_ingest_rate_items_per_second
  skill_graph_query_duration_seconds{operation=search|fetch|update}
  planner_decision_time_seconds
  orchestrator_execution_rate_tasks_per_minute
  knowledge_graph_update_latency_seconds
  ```

---

### 2. **Evidence Vault & Council Voting** (Phase 24.2–24.3)
- **Components:** Evidence Vault, MemoryStore Tier 2, Council voting, Policy rails, Decay logic
- **Panels:**
  - Evidence packet ingestion rate (packets/sec)
  - Council vote latency (time to quorum)
  - Policy rail enforcement rate (allowed/denied)
  - Decay score calculation time
  - Collection snapshot rollback success rate
  - Index health (cardinality, search latency by index type)

- **Why critical:** governance of autonomy; if voting fails, agent decisions are unvalidated

- **Metrics needed:**
  ```
  evidence_packet_ingest_total{status=success|failure}
  evidence_packet_ingest_duration_seconds
  council_vote_duration_seconds{vote_type=governance|policy|override}
  council_vote_consensus_rate
  policy_rail_enforcement_total{decision=allow|deny}
  decay_score_calculation_duration_seconds
  snapshot_rollback_total{status=success|failure}
  memorystore_index_cardinality{index_type=by_agent|by_phase|by_operation|by_date|by_status}
  memorystore_search_latency_seconds{index_type=...}
  ```

---

### 3. **Governance Audit & Policy Decisions** (Phase E / Phase 1 current)
- **Components:** Deterministic audit, Policy lineage, Risk scoring, Verdicts
- **Panels:**
  - Audit latency (deterministic checks <100ms)
  - Policy violations detected (count/min)
  - FAIL vs WARN vs PASS verdict distribution
  - Risk score distribution (0–100)
  - Cache hit rate (audit caching effectiveness)
  - Re-audit cycles triggered (policy version changes)

- **Why critical:** blocks unsafe skills; if audit is slow/wrong, bad skills execute

- **Metrics needed:**
  ```
  governance_audit_duration_ms{policy_version=X, status=success|failure}
  governance_policy_violations_total{policy_id=...}
  governance_verdict_total{verdict=PASS|WARN|FAIL}
  governance_risk_score_histogram{buckets=[0-10,10-30,30-60,60-100]}
  governance_cache_hit_rate{policy_version=X}
  governance_reaudit_triggered_total{reason=policy_version_change|force_reaudit}
  ```

---

### 4. **Skill Ingestion Pipeline** (Skills integration + Governance)
- **Components:** Extractors (ReverseImageSearch, Media), Skill registry, Governance gate
- **Panels:**
  - Skill ingestion rate (skills/hour)
  - Extractor success rate (ReverseImageSearch, Media ingestion)
  - Skill audit pass/fail breakdown
  - Governance gate allow/deny rate
  - Skill cache hit rate
  - Bulk operation throughput (skills batched per operation)

- **Why critical:** skills are the atomic unit of work; if pipeline breaks, nothing executes

- **Metrics needed:**
  ```
  skill_ingestion_rate_per_hour
  extractor_success_rate{extractor=reverse_image_search|media_ingest}
  skill_governance_audit_total{verdict=PASS|WARN|FAIL}
  skill_governance_gate_total{decision=allow|deny}
  skill_cache_hit_rate{skill_source=absolutely_skilled|local}
  bulk_operation_throughput_skills_per_operation
  ```

---

### 5. **TorqueQuery Search Engine** (Phase 26)
- **Components:** Ingestion, Index health, Query latency
- **Panels:**
  - Bundle ingestion rate (bundles/sec)
  - Dangling edges count (graph integrity)
  - Query latency (p50/p95/p99) by operation
  - Search result accuracy (precision/recall if available)
  - Index rebuild time + frequency
  - Concurrent query throughput

- **Why critical:** memory search is fundamental; if queries are slow, autonomy stalls

- **Metrics needed:**
  ```
  torque_bundle_ingest_total{status=success|failure}
  torque_dangling_edges_total
  torque_query_duration_seconds{operation=text_search|graph_traverse|field_filter}
  torque_query_throughput_per_second
  torque_index_rebuild_duration_seconds
  torque_index_rebuild_total
  torque_result_precision_score
  ```

---

### 6. **Memory Pipeline** (Phases 23.2–23.5)
- **Components:** MemoryStore (Phase 23.2), Harvester, Query API, Retention/Archival
- **Panels:**
  - Total memory entries + size (bytes)
  - Memory growth rate (items/hour, bytes/hour)
  - Compression ratio (bytes_out / bytes_in)
  - Archive success rate + restore latency
  - Query API latency (by operation: get, set, delete, query, archive)
  - Retention policy compliance (% entries matching policy)
  - Storage utilization (% of max_size_bytes)

- **Why critical:** memory is shared state; if it corrupts or is inaccessible, agents can't reason

- **Metrics needed:**
  ```
  memory_entries_total
  memory_size_bytes
  memory_growth_rate_items_per_hour
  memory_compression_ratio
  memory_archive_success_rate
  memory_restore_latency_seconds
  memory_query_api_duration_seconds{operation=get|set|delete|query|archive}
  memory_retention_policy_compliance_percent
  memory_storage_utilization_percent
  ```

---

## TIER 2: HIGH PRIORITY (Add within 1 week)

### 7. **ARL Reasoning Signals** (Phases 7.7–7.8)
- **Components:** Confidence model, Drift calculator
- **Panels:**
  - Confidence score distribution (low/medium/high)
  - Semantic drift detected (operations triggering drift)
  - Temporal drift (time-based anomalies)
  - Narrative drift (expected vs actual outcome)
  - Causal drift (dependency mismatches)
  - Drift alert rate (false positives)

- **Metrics needed:**
  ```
  arl_confidence_score_histogram{buckets=[low,medium,high]}
  arl_semantic_drift_total
  arl_temporal_drift_total
  arl_narrative_drift_total
  arl_causal_drift_total
  arl_drift_alert_total{is_false_positive=true|false}
  ```

---

### 8. **CI/CD Pipeline & Test Suite** (Phase 0.9 TheFoundry + Phase 7.15-7.20)
- **Components:** Docker build, Jest tests, Type checking, Linting
- **Panels:**
  - Build success rate (TheFoundry deterministic builds)
  - Test suite pass/fail (13 test suites, 88+ tests)
  - Test coverage trend (aim: 90%+)
  - Type checking errors
  - Lint violations (if enforced)
  - Deployment frequency (PRs merged/day)
  - Time from PR to production

- **Why high priority:** quality gate; bad builds/tests block autonomy

- **Metrics needed:**
  ```
  ci_build_success_rate
  ci_build_duration_seconds
  test_suite_passed_total
  test_suite_failed_total
  test_coverage_percent{suite=governance|memory|autonomy|torque}
  ci_type_check_errors_total
  ci_lint_violations_total
  ci_deployment_frequency_per_day
  ci_lead_time_minutes
  ```

---

### 9. **Extraction & Media Pipeline** (Phase 4.4 Repomix + ReverseImageSearch)
- **Components:** ReverseImageSearchExtractor, Media ingestion, Repomix
- **Panels:**
  - Extractor throughput (images/sec, repos/sec)
  - API latency (ReverseImageSearch, Repomix)
  - Error rate (API failures, parsing errors)
  - Validation success rate
  - Cache hit rate (duplicate detection)
  - Backpressure (queue depth)

- **Metrics needed:**
  ```
  extractor_throughput_items_per_second{extractor=reverse_image_search|repomix|media}
  extractor_api_latency_seconds{api=reverse_image_search|repomix}
  extractor_error_rate{error_type=api_failure|parse_error|validation_failure}
  extractor_cache_hit_rate
  extractor_queue_depth
  ```

---

### 10. **Skill Execution & Performance** (Wayland + Skills)
- **Components:** Tool adapters (Wayland), Skill execution, MCP proxy
- **Panels:**
  - Skill execution rate (executions/min)
  - Execution latency (p50/p95/p99)
  - Success rate
  - Timeout rate
  - Resource usage (CPU, memory per skill)
  - Adapter health (all tool adapters)

- **Metrics needed:**
  ```
  skill_execution_total{status=success|failure|timeout}
  skill_execution_duration_seconds{skill_id=...}
  skill_resource_cpu_percent{skill_id=...}
  skill_resource_memory_bytes{skill_id=...}
  wayland_adapter_health{adapter=...}
  mcp_proxy_latency_seconds
  ```

---

## TIER 3: MEDIUM PRIORITY (Add within 2 weeks)

### 11. **Caveman Compression** (Phases 23–24 memory optimization)
- **Panels:**
  - Bytes in/out/saved by tool + phase
  - Compression profile distribution
  - Recompression guard activations
  - Budget exhaustion rate
  - Total session bytes saved

- **Metrics needed:**
  ```
  caveman_bytes_in_total{tool_id=..., phase=...}
  caveman_bytes_out_total{...}
  caveman_bytes_saved_total{...}
  caveman_profile_usage_total{profile=...}
  caveman_recompression_guard_activations_total
  caveman_budget_exhausted_total
  caveman_session_bytes_saved
  ```

---

### 12. **Approval Infrastructure** (Phase E Policy Validator)
- **Components:** Real-time policy validator, Approval records
- **Panels:**
  - Policy validation latency
  - Zone violations detected
  - Approvals granted/denied
  - Approval queue depth
  - Manual override rate

- **Metrics needed:**
  ```
  approval_policy_validation_duration_ms
  approval_zone_violations_total
  approval_decisions_total{decision=granted|denied|pending}
  approval_queue_depth
  approval_manual_override_total
  ```

---

### 13. **CodeBurn Integration** (Phase 4.3)
- **Components:** Telemetry schemas, emitters, CodeBurn provider
- **Panels:**
  - Events sent to CodeBurn (events/min)
  - Telemetry pipeline latency
  - Provider uptime
  - Error rate

- **Metrics needed:**
  ```
  codeburn_events_sent_total{event_type=...}
  codeburn_telemetry_pipeline_latency_ms
  codeburn_provider_uptime_percent
  codeburn_error_rate
  ```

---

### 14. **Knowledge Graph** (Phase 25 preview)
- **Components:** Entity graph, relationship inference
- **Panels:**
  - Entity count by type
  - Relationship count
  - Graph update latency
  - Inference accuracy (if measured)
  - Query throughput

- **Metrics needed:**
  ```
  knowledge_graph_entity_count{entity_type=...}
  knowledge_graph_relationship_count
  knowledge_graph_update_latency_seconds
  knowledge_graph_query_throughput_per_second
  knowledge_graph_inference_accuracy_percent
  ```

---

### 15. **Social Media Orchestrator** (Phase 23.2 integration)
- **Components:** Hybrid Extractor+MCP+SkillNode
- **Panels:**
  - Post generation rate (posts/hour)
  - Orchestrator latency (end-to-end)
  - Content approval rate
  - Distribution success rate

- **Metrics needed:**
  ```
  social_media_post_generation_total{status=success|failure}
  social_media_orchestrator_latency_seconds
  social_media_content_approval_rate
  social_media_distribution_success_rate
  ```

---

## TIER 4: OPERATIONAL (Add by end of project)

### 16. **Family History Business Pipeline** (Phases 50–56)
- **Components:** Documentary processing, data extraction, export
- **Panels:**
  - Document ingestion rate
  - Processing success rate
  - Export throughput
  - Revenue/project metrics (if tracked)

---

### 17. **System Infrastructure**
- **Panels:**
  - Container/pod health (CPU, memory, restarts)
  - Network latency (inter-service)
  - Disk I/O + space
  - Database connection pool
  - Cache hit rates (Redis, etc.)

---

### 18. **Logs & Alerts Aggregation**
- **Panels:**
  - Error log volume (by component)
  - Alert firing rate
  - Alert resolution time
  - On-call pages (if integrated)

---

## PRIORITY SUMMARY TABLE

| Rank | Panel | Criticality | Scope | Visibility Gap | Days to Add |
|------|-------|-------------|-------|----------------|-------------|
| 1 | Autonomy Loop Health | Critical | 7 phases | High | 2–3 |
| 2 | Evidence Vault & Council | Critical | Phase 24 | High | 2–3 |
| 3 | Governance Audit | Critical | Phase E/1 | Medium | 1–2 |
| 4 | Skill Ingestion | Critical | Extractors+Gov | Medium | 1–2 |
| 5 | TorqueQuery | Critical | Phase 26 | High | 2–3 |
| 6 | Memory Pipeline | Critical | Phases 23.2–25 | Medium | 2 |
| 7 | ARL Reasoning | High | Phases 7.7–8 | High | 2 |
| 8 | CI/CD & Tests | High | Phase 0.9 + 7 | Low | 1 |
| 9 | Extraction & Media | High | Phase 4 | Medium | 2 |
| 10 | Skill Execution | High | Wayland | Low | 1 |
| 11 | Caveman Compression | Medium | Phases 23–24 | Medium | 1 |
| 12 | Approval Infrastructure | Medium | Phase E | High | 1–2 |
| 13 | CodeBurn | Medium | Phase 4.3 | High | 1 |
| 14 | Knowledge Graph | Medium | Phase 25 | High | 2 |
| 15 | Social Media Orchestrator | Medium | Phase 23.2 | High | 1–2 |
| 16 | Family History Business | Low | Phase 50+ | N/A | 3+ |
| 17 | System Infrastructure | Low | All | Low | 1 |
| 18 | Logs & Alerts | Low | All | Low | 1 |

---

## Implementation Roadmap

**Week 1 (immediate):**
- Tier 1: Autonomy, Evidence Vault, Governance, Skills, TorqueQuery, Memory
- Tier 2: ARL, CI/CD, Skill Execution

**Week 2:**
- Tier 2: Extraction, Approval, CodeBurn
- Tier 3: Caveman, Knowledge Graph, Social Media
- Tier 4: System, Logs/Alerts

**Ongoing:**
- Add new panels as components emit metrics
- Refine metrics based on operational needs

---

## Notes

- **Metrics don't exist yet** for many components (Autonomy, Evidence Vault, Knowledge Graph, etc.). Prioritize instrumenting Tier 1–2 components first.
- **Dashboard JSON template** ready; add panels incrementally.
- **Validation** in place; each new panel must include owner, runbook, alert_id.
- **CI job** enforces canonical metric names.
