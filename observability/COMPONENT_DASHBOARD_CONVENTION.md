# Component Dashboard Convention

**Purpose:** Signal that a component should have dashboard visibility + auto-generate panel spec.

---

## Step 1: Mark Component as Dashboard-Ready

Add `observability` block to component's metadata file (package.json, tsconfig, or dedicated `.dashboard.json`):

### Option A: package.json

```json
{
  "name": "my-feature",
  "observability": {
    "dashboard_ready": true,
    "component_id": "my_feature",
    "component_type": "service|agent|extractor|processor",
    "metrics": [
      {
        "name": "my_feature_requests_total",
        "type": "counter",
        "description": "Total requests to my_feature",
        "labels": ["status","operation"]
      },
      {
        "name": "my_feature_latency_seconds",
        "type": "histogram",
        "description": "Request latency",
        "labels": ["operation"],
        "buckets": [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
      },
      {
        "name": "my_feature_errors_total",
        "type": "counter",
        "description": "Total errors",
        "labels": ["error_type"]
      }
    ],
    "owner": "team@example.com",
    "runbook_url": "https://repo/runbooks/my_feature.md",
    "alert_threshold": "error_rate > 5%",
    "criticality": "TIER 2",
    "days_to_implement": 3
  }
}
```

### Option B: `.dashboard.json` (dedicated file)

```json
{
  "component_id": "my_feature",
  "component_type": "service",
  "dashboard_ready": true,
  "metrics": [
    {
      "name": "my_feature_requests_total",
      "type": "counter",
      "description": "Total requests",
      "labels": ["status","operation"]
    },
    {
      "name": "my_feature_latency_seconds",
      "type": "histogram",
      "description": "Latency",
      "labels": ["operation"],
      "buckets": [0.01, 0.05, 0.1, 0.5, 1]
    }
  ],
  "owner": "team@example.com",
  "runbook_url": "https://repo/runbooks/my_feature.md",
  "criticality": "TIER 2",
  "days_to_implement": 3
}
```

### Option C: TypeScript code annotation (in main source file)

```ts
/**
 * @dashboard
 * @component_id my_feature
 * @component_type service
 * @owner team@example.com
 * @runbook https://repo/runbooks/my_feature.md
 * @criticality TIER 2
 * @days_to_implement 3
 */

export class MyFeature {
  // implementation
}
```

---

## Step 2: Emit Metrics

Your component must export Prometheus metrics matching the declared names:

```ts
// src/my-feature/index.ts
import { register, Counter, Histogram } from 'prom-client';

export const myFeatureRequests = new Counter({
  name: 'my_feature_requests_total',
  help: 'Total requests to my_feature',
  labelNames: ['status','operation']
});

export const myFeatureLatency = new Histogram({
  name: 'my_feature_latency_seconds',
  help: 'Request latency',
  labelNames: ['operation'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

export const myFeatureErrors = new Counter({
  name: 'my_feature_errors_total',
  help: 'Total errors',
  labelNames: ['error_type']
});

// Expose /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

---

## Step 3: Run Dashboard Generator at Build End

At end of build/test phase, run:

```bash
node observability/generators/suggest_dashboard_panels.js src/my-feature
```

**Output:** Generates panel specs + suggests adding to roadmap:

```
✓ Dashboard-ready component detected: my_feature
✓ Generated 3 panel specs (requests, latency, errors)
✓ Owner: team@example.com | Criticality: TIER 2 | Days: 3

Next: Add to roadmap with:
  npx cic roadmap add-dashboard-panel \
    --component my_feature \
    --owner team@example.com \
    --criticality TIER 2 \
    --days 3 \
    --panels requests,latency,errors
```

---

## Step 4: Dev Adds to Roadmap (Manual or Auto)

### Manual (interactive)
```bash
npx cic roadmap add-dashboard-panel --component my_feature
# → prompts for owner, criticality, days, which panels
# → creates roadmap entry
# → generates dashboard JSON
```

### Auto (CI/CD)
```bash
# In CI job after tests pass:
node observability/generators/auto_add_dashboard_panels.js \
  --components-dir src \
  --roadmap-file CIC_MASTER_ROADMAP.md
```

---

## Metric Spec Schema

```typescript
interface MetricSpec {
  name: string;           // Prometheus metric name (snake_case)
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  description: string;    // Help text
  labels?: string[];      // Label names
  buckets?: number[];     // Histogram buckets (if type=histogram)
}

interface ComponentDashboardMetadata {
  component_id: string;              // slug: my_feature
  component_type: 'service' | 'agent' | 'extractor' | 'processor' | 'skill' | 'orchestrator';
  dashboard_ready: boolean;
  metrics: MetricSpec[];
  owner: string;                     // team@example.com
  runbook_url: string;               // https://repo/runbooks/...
  alert_threshold?: string;          // e.g. "error_rate > 5%"
  criticality: 'TIER 1' | 'TIER 2' | 'TIER 3' | 'TIER 4';
  days_to_implement: number;         // 1–7
}
```

---

## Generated Dashboard Panel Template

Generator produces JSON panel matching Command Center convention:

```json
{
  "id": null,
  "type": "graph",
  "title": "My Feature — Requests, Latency, Errors",
  "gridPos": {"x": 0, "y": 0, "w": 12, "h": 6},
  "datasource": "${DS_PROMETHEUS}",
  "targets": [
    {
      "expr": "sum(rate(my_feature_requests_total[1m])) by (status, operation)",
      "legendFormat": "{{status}} {{operation}}"
    },
    {
      "expr": "histogram_quantile(0.95, sum(rate(my_feature_latency_seconds_bucket[5m])) by (le, operation))",
      "legendFormat": "p95 {{operation}}"
    },
    {
      "expr": "sum(rate(my_feature_errors_total[5m])) by (error_type)",
      "legendFormat": "errors {{error_type}}"
    }
  ],
  "description": "owner: team@example.com\nrunbook: https://repo/runbooks/my_feature.md\nalert_id: my_feature_health\ncriticality: TIER 2\ndays_to_implement: 3"
}
```

---

## Example: Full Workflow

### 1. Build Feature
```bash
# src/my-feature/package.json has observability block
npm test  # pass
```

### 2. Build Hook Detects & Suggests
```bash
# Hook runs at end of build:
node observability/generators/suggest_dashboard_panels.js src/my-feature

Output:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Dashboard-ready component: my_feature
✓ Metrics declared: 3 (requests, latency, errors)
✓ Owner: team@example.com
✓ Criticality: TIER 2 | Days: 3

Next step:
  npx cic roadmap add-dashboard-panel --component my_feature
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3. Dev Runs Suggestion
```bash
npx cic roadmap add-dashboard-panel --component my_feature

# → prompts:
# ✓ Component: my_feature
# ✓ Owner: team@example.com (from metadata)
# ✓ Criticality: TIER 2 (from metadata)
# ✓ Days to implement: 3 (from metadata)
# ✓ Which panels? (requests, latency, errors) [all]

# → creates:
# ✓ Roadmap entry: PHASE 23.7: Dashboard — My Feature (3 days)
# ✓ Generated JSON: observability/dashboards/generated/my_feature_panel.json
# ✓ Updated: COMMAND-CENTER-PRIORITY-MATRIX.md (new row)
```

### 4. PR Review
```
[PR] Add my_feature observability dashboard
- Dashboard panel auto-generated from component metadata
- Metrics: requests_total, latency_seconds, errors_total
- Owner: team@example.com
- Criticality: TIER 2 | Days: 3
- Ready to merge & queue for dashboard sprint
```

### 5. Later: Sprint Implementation
```bash
# Roadmap item: "Phase 23.7: Dashboard — My Feature"
# Assigned to dashboard team (3-day sprint)
# → implement panel design, validate metrics, add to CIC_SYSTEM_OVERVIEW.json
```

---

## Generator Script (`observability/generators/suggest_dashboard_panels.js`)

```js
// observability/generators/suggest_dashboard_panels.js
const fs = require('fs');
const path = require('path');

function findDashboardMetadata(componentDir) {
  // Check package.json
  const pkgPath = path.join(componentDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.observability && pkg.observability.dashboard_ready) {
      return pkg.observability;
    }
  }

  // Check .dashboard.json
  const dashPath = path.join(componentDir, '.dashboard.json');
  if (fs.existsSync(dashPath)) {
    const dashboard = JSON.parse(fs.readFileSync(dashPath, 'utf8'));
    if (dashboard.dashboard_ready) {
      return dashboard;
    }
  }

  return null;
}

function generatePanelSpec(metadata) {
  const targets = metadata.metrics.map(m => {
    let expr = '';
    if (m.type === 'counter') {
      const labels = m.labels ? ` by (${m.labels.join(',')})` : '';
      expr = `sum(rate(${m.name}[1m]))${labels}`;
    } else if (m.type === 'histogram') {
      const labels = m.labels ? `, ${m.labels.join(',')}` : ', le';
      expr = `histogram_quantile(0.95, sum(rate(${m.name}_bucket[5m])) by (${labels}))`;
    } else if (m.type === 'gauge') {
      expr = `${m.name}`;
    }
    return {
      expr,
      legendFormat: m.name
    };
  });

  const panel = {
    id: null,
    type: 'graph',
    title: `${metadata.component_id} — ${metadata.metrics.map(m => m.name.replace(/_total|_seconds|_bytes/g, '')).join(', ')}`,
    gridPos: { x: 0, y: 0, w: 12, h: 6 },
    datasource: '${DS_PROMETHEUS}',
    targets,
    description: `owner: ${metadata.owner}\nrunbook: ${metadata.runbook_url}\nalert_id: ${metadata.component_id}_health\ncriticality: ${metadata.criticality}\ndays_to_implement: ${metadata.days_to_implement}`
  };

  return panel;
}

function main() {
  const componentDir = process.argv[2];
  if (!componentDir) {
    console.error('Usage: node suggest_dashboard_panels.js <component_dir>');
    process.exit(2);
  }

  const metadata = findDashboardMetadata(componentDir);
  if (!metadata) {
    console.log(`ℹ No dashboard-ready component found in ${componentDir}`);
    return;
  }

  const panel = generatePanelSpec(metadata);

  console.log(`
╔════════════════════════════════════════════════╗
║ Dashboard-Ready Component Detected             ║
╚════════════════════════════════════════════════╝
✓ Component: ${metadata.component_id}
✓ Metrics: ${metadata.metrics.length} (${metadata.metrics.map(m => m.name).join(', ')})
✓ Owner: ${metadata.owner}
✓ Criticality: ${metadata.criticality}
✓ Days to implement: ${metadata.days_to_implement}

Panel spec generated:
${JSON.stringify(panel, null, 2)}

Next step:
  npx cic roadmap add-dashboard-panel --component ${metadata.component_id}
  `);
}

main();
```

---

## CI Integration Hook

Add to end of build job (`Makefile` or `.github/workflows/ci.yml`):

```bash
# After tests pass:
echo "Checking for dashboard-ready components..."
find src -maxdepth 2 -type f \( -name 'package.json' -o -name '.dashboard.json' \) | while read f; do
  dir=$(dirname "$f")
  node observability/generators/suggest_dashboard_panels.js "$dir"
done
```

---

## Notes

- **Metadata convention** prevents dashboard sprawl; only intentional components get panels
- **Generator** ensures consistency (all panels follow schema, metadata validation)
- **Roadmap integration** lets dev/ops review + schedule dashboard work
- **Pre-generated JSON** ready for implementation sprint (no re-work)
- **Fallback:** if component doesn't declare metrics, generator skips silently

---

## Checklist for New Feature Build

Before marking `dashboard_ready: true`:

- [ ] Component exports metrics to Prometheus
- [ ] Metrics match declared names/types/labels
- [ ] Owner assigned (team@example.com)
- [ ] Runbook URL valid
- [ ] Criticality (TIER 1–4) assigned
- [ ] Days to implement estimated (1–7)
- [ ] Metrics tested in `/metrics` endpoint
