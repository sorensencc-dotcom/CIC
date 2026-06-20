# CIC Observability

Canonical observability suite for CIC: dashboards, alerts, exporters, and validation.

## Structure

```
observability/
├── dashboards/
│   ├── system/
│   │   └── CIC_SYSTEM_OVERVIEW.json    # Main system dashboard
│   └── archive/                         # Deprecated dashboards
├── exporters/
│   ├── caveman_exporter.js             # CAVEMAN_STATS → Prometheus
│   ├── caveman_exporter.py
│   └── README.md                        # Exporter deployment guide
├── validation/
│   ├── scripts/
│   │   ├── validate_dashboard.js       # Structure validation
│   │   ├── lint_queries.js             # Query canonicalization
│   │   └── check_panel_metadata.js     # Metadata enforcement
│   └── package.json
├── ops/
│   ├── alerts.yml                       # Alert rules
│   ├── nodes.md                         # Service inventory
│   └── runbooks/                        # Alert runbooks
└── README.md (this file)
```

## Quick Start

### Add a new dashboard

1. Create `observability/dashboards/system/NEW_DASHBOARD.json`
2. Use `CIC_SYSTEM_OVERVIEW.json` as template
3. Each panel must include metadata in description:
   ```
   owner: ops-team@example.com
   runbook: https://repo/runbooks/component.md
   alert_id: cic_component_condition
   ```

4. Validate locally:
   ```bash
   cd observability/validation
   npm install
   npm run validate-all
   ```

5. Queries must use canonical metrics. Full list in `lint_queries.js`.

6. Open PR; CI validates automatically.

### Canonical Metrics

All dashboard queries must reference these metrics:

**Wayland:**
- `wayland_tool_exec_total`, `wayland_tool_exec_failures_total`, `wayland_tool_exec_duration_seconds_bucket`

**Caveman:**
- `caveman_bytes_in_total`, `caveman_bytes_out_total`, `caveman_bytes_saved_total`, `caveman_profile_usage_total`, `caveman_budget_exhausted_total`, `caveman_total_bytes_saved_session`

**Governance:**
- `governance_decision_allowed_total`, `governance_decision_denied_total`

**TorqueQuery:**
- `torque_ingest_bundles_total`, `torque_ingest_latency_seconds_bucket`, `torque_dangling_edges_total`

**Agents:**
- `agent_heartbeat_timestamp`, `agent_restart_count_total`

**Skills:**
- `claude_code_skill_calls_total`, `mcp_proxy_requests_total`, `mcp_proxy_request_duration_seconds_bucket`

**CI/Tests:**
- `ci_pipeline_runs_total`, `test_suite_passed_total`, `test_suite_failed_total`

See `validation/scripts/lint_queries.js` for complete list.

### Alert Rules

Every panel must define an alert. Format in description:
```
alert_id: cic_<component>_<condition>
```

Examples:
- `cic_wayland_exec_drop` — execution rate dropped
- `cic_caveman_budget_exhausted` — compression budget exceeded
- `cic_governance_denials_spike` — policy violations spike
- `cic_test_suite_failed` — tests failing

Alerts routed by severity:
- **Critical** → PagerDuty + #cic-ops Slack
- **Warning** → #cic-ops Slack + email digest
- **Info** → email digest

### Runbooks

Every alert must link to a runbook. Format:
```
runbook: https://repo/runbooks/component.md
```

Runbook must include:
- **What triggered**: alert condition
- **How to investigate**: queries, logs, common causes
- **How to fix**: remediation steps
- **Escalation**: who to page if stuck

### Exporters

Some metrics don't auto-instrument. Convert logs/CAVEMAN_STATS to metrics:

```bash
# Node exporter
node observability/exporters/caveman_exporter.js &

# Python exporter
python observability/exporters/caveman_exporter_py.py &
```

Then configure Prometheus scrape targets to `localhost:9102` (Node) or `localhost:8000` (Python).

### Provisioning

Grafana auto-loads dashboards from:
```
observability/dashboards/system/*.json
```

Or via Grafana provisioning YAML:
```yaml
providers:
  - name: 'CIC System'
    orgId: 1
    folder: 'CIC'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

## Validation Pipeline

### Local
```bash
cd observability/validation
npm install
npm run validate-all
```

### CI
Automatically runs on PRs touching `observability/**`:
- `validate_dashboard.js` — JSON structure + metadata completeness
- `lint_queries.js` — queries use canonical metrics
- `check_panel_metadata.js` — owner, runbook, alert_id present

All must pass before merge.

## Deprecation

To retire a dashboard:

1. Add `deprecated_at` and `archive_reason` fields to JSON:
   ```json
   {
     "dashboard": {
       "deprecated_at": "2026-06-30",
       "archive_reason": "Merged into CIC_SYSTEM_OVERVIEW; see PR #123",
       ...
     }
   }
   ```

2. Move to `observability/dashboards/archive/OLD_DASHBOARD.json`

3. Open PR with migration notes:
   - Which panels moved where
   - Link to new dashboard
   - Timeline for full removal

4. Notify panel owners; they update alert routing.

## Files Created

- `observability/dashboards/system/CIC_SYSTEM_OVERVIEW.json` — 17-panel canonical dashboard
- `observability/validation/scripts/validate_dashboard.js` — JSON structure validation
- `observability/validation/scripts/lint_queries.js` — Query canonicalization
- `observability/validation/scripts/check_panel_metadata.js` — Metadata enforcement
- `.github/workflows/observability-validate.yml` — CI validation job

## Next Steps

1. Deploy exporters for missing metrics (see `exporters/` for snippets)
2. Configure Prometheus scrape targets
3. Set up alert rules (ops/alerts.yml)
4. Add runbooks under ops/runbooks/
5. Provision dashboards to Grafana

## Contact

- **Dashboard owner**: ops-team@example.com
- **On-call**: See [ops/nodes.md](ops/nodes.md)
- **Runbooks**: [ops/runbooks/](ops/runbooks/)
