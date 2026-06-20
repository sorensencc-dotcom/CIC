# Unified Dashboard Architecture (Inventory)

**Status:** Capturing current state + gaps  
**Phase:** Inventory, not design yet  

---

## Concept

**Single canonical dashboard:** CIC_SYSTEM_OVERVIEW.json (all 18+ panels)

**Filtered views (tabs/filters):**
- **System Health** — agent heartbeat, phase transitions, error rate
- **Governance Ops** — audit latency, policy violations, risk scores, re-audit cycles
- **Memory Ops** — ingest rate, compression, archival, retention compliance
- **Autonomy Ops** — skill execution, planner/orchestrator latency, knowledge graph
- **TorqueQuery Ops** — bundle ingest, dangling edges, query latency
- **Extraction Ops** — extractor throughput, API latency, validation rate
- **CI/CD** — build success, test coverage, deployment frequency
- **Infrastructure** — pods, network, disk, DB connections
- **Logs & Alerts** — error volume, alert firing rate

**Implementation:** Single JSON file + Grafana dashboard variables (dropdowns) to filter by tag/label/owner.

---

## Components Requiring Observability Scan

### Backend Systems (Backend Priority — scan first)

#### **Governance**
- ✅ Phase 1: Deterministic audit (in CIC repo, telemetry ready)
- ❓ Phase 2: Semantic audit (LLM integration) — needs observability spec
- ❓ Phase 3+: GovernanceGate, ExecutionMonitor, AnomalyDetector

#### **Memory Layer**
- ✅ Phases 23.2–23.5: MemoryStore, Harvester, Query API, Retention (complete)
- ❓ Metrics exported to Prometheus? (scan codebase)
- ❓ Phase 23.6: Memory Explorer UI (web dashboard for memory state)

#### **Autonomy Stack**
- ❓ Phase 23 (Memory) — heartbeat, ingest
- ❓ Phase 24 (Evidence Vault + Council Voting) — packet ingest, vote latency, consensus rate
- ❓ Phase 25 (Skill Graph) — graph queries, index latency
- ❓ Phase 26 (TorqueQuery) — bundle ingest, dangling edges
- ❓ Phase 27 (Planner) — planning duration, decision latency
- ❓ Phase 28 (Orchestrator) — execution rate, task success
- ❓ Phase 29 (Knowledge Graph) — entity/relationship count, update latency

#### **Extractors & Ingestion**
- ✅ ReverseImageSearch (Phase 7.15–20, validated) — needs metrics spec
- ❓ Media ingestion — throughput, validation
- ❓ Repomix (Phase 4.4) — repo ingest, latency
- ❓ Rewrite Labs Harvester — item ingest, processing latency
- ❓ Social Media Orchestrator (Phase 23.2) — post generation, approval, distribution

#### **Skills & Execution**
- ✅ Wayland adapters (tool execution) — needs metrics spec
- ❓ MCP proxy — request latency, error rate
- ❓ Claude Code skill — call latency, success rate
- ❓ 754 Cybersecurity skills — execution rate, coverage

#### **Other**
- ❓ CodeBurn integration (Phase 4.3) — telemetry emit latency
- ❓ ARL confidence + drift (Phases 7.7–8) — drift detection, false positive rate
- ❓ Phase E Real-Time Policy Validator — validation latency, zone violations
- ❓ Caveman compression — bytes saved, profile usage, budget exhaustion

---

## Observability Gaps (Inventory)

### Metrics Missing

| Component | Panel | Metric Name(s) | Status |
|-----------|-------|-----------------|--------|
| Memory (23.2–23.5) | Memory Pipeline | memory_ingest_entries_total, memory_compression_ratio | ❓ verify exists |
| Evidence Vault | Council Voting | evidence_packets_ingested_total, council_vote_consensus_rate | ❌ needs spec |
| Skill Graph (Phase 25) | Graph Queries | skill_graph_query_duration, skill_graph_index_cardinality | ❌ needs spec |
| TorqueQuery (Phase 26) | Bundle Ingest | torque_ingest_bundles_total, torque_dangling_edges | ✅ in roadmap |
| Planner (Phase 27) | Planning Duration | planner_decision_duration, planner_reasoning_steps | ❌ needs spec |
| Orchestrator (Phase 28) | Execution | orchestrator_task_execution_rate, orchestrator_success_rate | ❌ needs spec |
| Knowledge Graph (Phase 29) | Entity Count | kg_entity_count, kg_relationship_count, kg_update_latency | ❌ needs spec |
| Repomix | Repo Ingest | repomix_repo_ingest_total, repomix_file_count | ❌ needs spec |
| Rewrite Labs Harvester | Harvester Ingest | harvester_item_ingest_rate, harvester_processing_latency | ❌ needs spec |
| Social Media Orchestrator | Post Generation | smo_post_generation_rate, smo_approval_rate, smo_distribution_success | ❌ needs spec |
| Cybersecurity Skills | Skill Execution | cyber_skill_exec_total, cyber_skill_coverage_percent | ❌ needs spec |
| CodeBurn | Telemetry | codeburn_events_sent_total, codeburn_telemetry_latency | ❌ needs spec |
| ARL | Drift Detection | arl_semantic_drift_total, arl_false_positive_rate | ❌ needs spec |
| Phase E Validator | Policy Validation | policy_validation_latency, zone_violations_detected | ❌ needs spec |

---

## Inventory Summary

### Phases with Observability (Ready)
- Phase 1: Governance (deterministic audit)
- Phases 23.2–23.5: Memory layer
- Phase 26: TorqueQuery

### Phases Needing Observability Spec
- Phase 24: Evidence Vault + Council Voting
- Phase 25: Skill Graph
- Phase 27: Planner
- Phase 28: Orchestrator
- Phase 29: Knowledge Graph
- Phase 4.3: CodeBurn
- Phase 4.4: Repomix
- Phase 7.7–8: ARL
- Phase E: Real-Time Policy Validator
- Extractors: ReverseImageSearch, Media, Rewrite Labs Harvester
- Skills: Claude Code, 754 Cybersecurity, MCP proxy
- Phase 23.2: Social Media Orchestrator
- Caveman: Compression metrics

### Systems to Check (Rewrite Labs)
- Rewrite Labs API/gateway
- Rewrite Labs Harvester (item ingest)
- Any custom adapters or processors
- Any shared infrastructure (caching, queuing, logging)

---

## Unified Dashboard Architecture (Concept)

### Single File
```
observability/dashboards/system/CIC_SYSTEM_OVERVIEW.json
├── 18+ canonical panels (all metrics)
├── Templating variables (filters)
├── Annotations (owner, alert_id, criticality)
└── Links (to filtered views)
```

### Filtered Views (Grafana Dashboard Variables)

```
Filter by: [System Health ▼] [View: All ]
├── System Health
│   └── Agent heartbeat, phase transitions, error rate
├── Governance Ops
│   └── Audit latency, violations, risk scores
├── Memory Ops
│   └── Ingest, compression, retention
├── Autonomy Ops
│   └── Skill exec, planner, orchestrator, KG
├── TorqueQuery Ops
│   └── Bundle ingest, dangling edges
├── Extraction Ops
│   └── Extractor throughput, API latency
├── CI/CD
│   └── Build, tests, coverage
├── Infrastructure
│   └── Pods, network, disk, DB
└── Logs & Alerts
    └── Error volume, alert rate
```

**Implementation:**
- Add `panel_group` or `component_area` label to each panel description
- Grafana variable `${area}` filters panels by group
- Dashboard dynamically shows/hides panels based on filter

---

## Process for Completing Inventory

### For Each Phase/Component

1. **Find codebase** (src/*, Rewrite Labs, external)
2. **Check for metrics exports** (grep for `Counter`, `Gauge`, `Histogram`, `/metrics`)
3. **If no metrics:** add to observability spec (COMPONENT_DASHBOARD_CONVENTION.md)
4. **If metrics exist:** catalog them in this document (add ✅)
5. **Create roadmap item** (e.g., "Phase 24.X: Observability — Evidence Vault")
6. **Add to COMMAND-CENTER-PRIORITY-MATRIX.md** with days_to_implement

---

## Next Steps (No Design Yet)

1. **Scan Rewrite Labs** for tools needing observability (you asked this)
2. **Audit existing phases** for metrics (Phases 24–29, Extractors, Skills)
3. **Document gaps** (this table)
4. **Create observability specs** for missing components (e.g., Evidence Vault, Planner, KG)
5. **Add roadmap items** (Phase X.Y: Observability — Component)
6. **Prioritize** (backend first, dashboard later)
7. **Once inventory complete, draft comprehensive plan** (unified dashboard + views)

---

## Notes

- **Single unified dashboard** avoids sprawl (no per-team dashboards)
- **Filtered views** let ops teams focus on their area
- **All metrics in one place** — easier to debug cross-system issues
- **Roadmap captures observability as inventory grows**
- **Backend > Dashboard** — telemetry first, UI second
