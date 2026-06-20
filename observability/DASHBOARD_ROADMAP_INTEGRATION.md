# Dashboard Roadmap Integration

**Purpose:** Auto-suggest & queue dashboard panels when new components are built.

---

## Workflow

### 1. Dev Builds Feature

```bash
# src/my-feature/
npm test  # pass
```

**Add to package.json:**
```json
{
  "observability": {
    "dashboard_ready": true,
    "component_id": "my_feature",
    "component_type": "service",
    "metrics": [
      {
        "name": "my_feature_requests_total",
        "type": "counter",
        "labels": ["status","operation"]
      },
      {
        "name": "my_feature_latency_seconds",
        "type": "histogram",
        "labels": ["operation"]
      }
    ],
    "owner": "team@example.com",
    "runbook_url": "https://repo/runbooks/my_feature.md",
    "criticality": "TIER 2",
    "days_to_implement": 3
  }
}
```

---

### 2. Build Hook Suggests

At end of CI job (after tests pass):

```bash
# .github/workflows/ci.yml
- name: Suggest Dashboard Panels
  run: |
    find src -maxdepth 2 -type f -name 'package.json' | while read f; do
      dir=$(dirname "$f")
      node observability/generators/suggest_dashboard_panels.js "$dir" || true
    done
```

**Output:**
```
╔════════════════════════════════════════════════╗
║ Dashboard-Ready Component Detected             ║
╚════════════════════════════════════════════════╝
✓ Component: my_feature
✓ Metrics: 2 (requests_total, latency_seconds)
✓ Owner: team@example.com
✓ Criticality: TIER 2
✓ Days to implement: 3

Next step:
  npx cic roadmap add-dashboard-panel --component my_feature
```

---

### 3. Dev Adds to Roadmap

When ready to surface feature:

```bash
npx cic roadmap add-dashboard-panel --component my_feature
```

**Prompts:**
```
Component: my_feature (detected)
Owner: team@example.com (from metadata)
Criticality: TIER 2 (from metadata)
Days to implement: 3 (from metadata)

Metrics detected:
  - my_feature_requests_total (counter)
  - my_feature_latency_seconds (histogram)

Add all metrics to dashboard? [y/n] y

✓ Roadmap entry created: Phase 23.X — Dashboard: My Feature (3 days)
✓ Panel JSON generated: observability/dashboards/generated/my_feature.json
✓ COMMAND-CENTER-PRIORITY-MATRIX.md updated
✓ Ready for dashboard sprint
```

---

### 4. Queue for Implementation

Roadmap entry added:

```
**Phase 23.X: Dashboard — My Feature**
- Criticality: TIER 2
- Days to implement: 3
- Owner: team@example.com
- Metrics: requests, latency
- Runbook: https://repo/runbooks/my_feature.md
- Panel JSON: observability/dashboards/generated/my_feature.json
- Status: queued for dashboard sprint
```

---

### 5. Dashboard Sprint

Dashboard team picks up Phase 23.X:

```bash
# Implementer:
1. Reviews panel JSON (observability/dashboards/generated/my_feature.json)
2. Validates metrics are being exported (checks /metrics endpoint)
3. Refines panel styling/layout (if needed)
4. Merges to observability/dashboards/system/CIC_SYSTEM_OVERVIEW.json
5. Runs validation scripts:
   - validate_dashboard.js ✓
   - lint_queries.js ✓
   - check_panel_metadata.js ✓
6. Updates COMMAND-CENTER-PRIORITY-MATRIX.md (moves from "queued" to "implemented")
7. PR review + merge
```

---

## CLI Commands (to implement)

### `npx cic roadmap add-dashboard-panel`

```bash
npx cic roadmap add-dashboard-panel --component my_feature [--interactive]
```

**Args:**
- `--component` (required) — component ID
- `--owner` (optional) — defaults from metadata
- `--criticality` (optional) — TIER 1–4, defaults from metadata
- `--days` (optional) — 1–7, defaults from metadata
- `--interactive` (optional) — prompts for confirmation

**Actions:**
1. Detects component metadata (package.json or .dashboard.json)
2. Generates panel JSON to `observability/dashboards/generated/{component_id}.json`
3. Creates roadmap entry in `CIC_MASTER_ROADMAP.md` or task queue
4. Prints summary:
   ```
   ✓ Roadmap entry: Phase 23.X — Dashboard: my_feature
   ✓ Days: 3 | Owner: team@example.com | Criticality: TIER 2
   ✓ Panel JSON: observability/dashboards/generated/my_feature.json
   ✓ Next: Dashboard team implements in sprint
   ```

---

### `npx cic roadmap list-dashboard-pending`

```bash
npx cic roadmap list-dashboard-pending
```

**Output:**
```
Pending Dashboard Panels (6):
1. my_feature (TIER 2, 3 days) — owner: team@example.com
2. some_extractor (TIER 3, 2 days) — owner: extraction@example.com
3. knowledge_graph (TIER 3, 4 days) — owner: kg@example.com
...

Next: Assign to dashboard sprint or start implementation
```

---

### `npx cic roadmap mark-dashboard-implemented`

```bash
npx cic roadmap mark-dashboard-implemented --component my_feature --merged-to main
```

**Actions:**
1. Move `Phase 23.X` from "queued" to "implemented"
2. Update `COMMAND-CENTER-PRIORITY-MATRIX.md`
3. Update `CIC_SYSTEM_OVERVIEW.json` to include panel (if auto-merge enabled)
4. Tag commit

---

## Files Generated

At `npx cic roadmap add-dashboard-panel --component my_feature`:

```
observability/dashboards/generated/
├── my_feature.json
├── some_extractor.json
└── knowledge_graph.json

COMMAND-CENTER-PRIORITY-MATRIX.md (updated):
- [my_feature](observability/dashboards/generated/my_feature.json) — TIER 2, 3 days, QUEUED

CIC_MASTER_ROADMAP.md (updated):
Phase 23.X: Dashboard — My Feature (3 days, QUEUED)
  - Owner: team@example.com
  - Panel JSON: observability/dashboards/generated/my_feature.json
  - Dependencies: metrics exported, runbook ready
  - Next: Dashboard sprint
```

---

## Integration with Build System

### Makefile

```makefile
.PHONY: build
build:
	npm run build
	npm run test
	@echo "Checking for dashboard-ready components..."
	@find src -maxdepth 2 -type f -name 'package.json' | while read f; do \
		dir=$$(dirname "$$f"); \
		node observability/generators/suggest_dashboard_panels.js "$$dir" || true; \
	done

.PHONY: dashboard-suggest
dashboard-suggest:
	@find src -maxdepth 2 -type f -name 'package.json' | while read f; do \
		dir=$$(dirname "$$f"); \
		node observability/generators/suggest_dashboard_panels.js "$$dir" || true; \
	done

.PHONY: roadmap-add-dashboard
roadmap-add-dashboard:
	npx cic roadmap add-dashboard-panel --component $(COMPONENT)
```

### GitHub Actions

```yaml
# .github/workflows/ci.yml
  - name: Check for Dashboard-Ready Components
    run: |
      find src -maxdepth 2 -type f -name 'package.json' | while read f; do
        dir=$(dirname "$f")
        node observability/generators/suggest_dashboard_panels.js "$dir" 2>/dev/null || true
      done

  - name: Archive Dashboard Panel Specs
    if: success()
    uses: actions/upload-artifact@v3
    with:
      name: dashboard-panels
      path: observability/dashboards/generated/
```

---

## Validation (CI Job)

Before merging dashboard panels to main:

```bash
# observability/validation/ci-dashboard.yml
script:
  - npm run dashboard-validate
  - npm run dashboard-lint-queries
  - npm run dashboard-check-metadata
  # ensures all panels in main/ pass validation
  # generated/ are pre-validated at suggest time
```

---

## Summary

**Flow:**
1. Dev builds feature, marks `dashboard_ready: true` in metadata
2. CI hook suggests dashboard panel → console output
3. Dev runs `npx cic roadmap add-dashboard-panel --component X`
4. Roadmap entry created (queued)
5. Dashboard team implements in sprint
6. `npx cic roadmap mark-dashboard-implemented --component X`
7. Panel moves from `generated/` → `system/CIC_SYSTEM_OVERVIEW.json`

**Result:**
- Zero manual JSON writing (auto-generated from metadata)
- Metrics validated before panel creation
- Roadmap tracks all pending + implemented panels
- Reduces friction: suggest → queue → implement
