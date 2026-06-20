# Caveman Compression Observability Spec

**Purpose:** Unify Caveman metrics + integrate with CodeBurn/TokenEconomyAgent cost tracking  
**Status:** Inventory capture (backend-ready, dashboard to follow)

---

## What Caveman Does

**Real-time context compression** — reduces token usage in LLM prompts/responses via:
- Selective redaction (remove unused code sections)
- Tree-sitter-based syntax compression (minimize whitespace, collapse structures)
- Recompression guard (prevent re-compression above cost threshold)
- Budget enforcement (max_bytes_saved_per_operation)

**Output:** compressed context that's syntactically valid but ~30–50% smaller (token reduction).

---

## Current Metrics (Already Declared)

From COMMAND-CENTER-PRIORITY-MATRIX.md:
```
caveman_bytes_in_total{tool_id, agent_id, pipeline_stage}       # input to compression
caveman_bytes_out_total{tool_id, agent_id, pipeline_stage}      # output (compressed)
caveman_bytes_saved_total{tool_id, agent_id, pipeline_stage}    # delta (in - out)
caveman_profile_usage_total{profile, tool_id}                   # which profile used
caveman_budget_exhausted_total{rule_id}                         # budget constraint hit
caveman_total_bytes_saved_session{...}                          # cumulative in session
caveman_compression_ratio{tool_id, agent_id}                    # out / in (lower = better)
```

---

## New: Token Equivalent Metrics

**Link Caveman → Token Cost Tracking**

### Basic Conversion
```
caveman_tokens_saved_equivalent = caveman_bytes_saved / 4
# Rough rule: 1 token ≈ 4 bytes (encoder-dependent, but close for GPT/Claude)
```

### Dashboard Metrics
```
caveman_tokens_saved_total{tool_id, agent_id}                   # cumulative tokens saved
caveman_cost_avoidance_usd_total{tool_id, agent_id}             # tokens_saved × model_rate
caveman_efficiency_score{tool_id}                               # bytes_saved / bytes_in (0-1)
caveman_recompression_guard_activation_rate{rule_id}            # % ops that hit budget
caveman_profile_performance{profile}                            # compression_ratio by profile
```

---

## Integration with CodeBurn/TokenEconomyAgent

### Cost Reduction Attribution
```
total_cost_savings = caveman_cost_avoidance + repomix_compression_savings + other
roi_percent = cost_savings / total_cost_spent × 100

CodeBurn feedback loop includes:
  - Caveman efficiency score (% context reduction achieved)
  - Caveman cost avoidance (tokens saved → cost avoided)
  - Caveman recompression violations (budget exhaustion rate)
    → Recommendations: adjust profile, raise budget, or redesign context structure
```

### TokenEconomyAgent Integration
```
Token budget accounting:
  actual_tokens_used = tokens_requested - caveman_tokens_saved
  effective_budget_used = actual_tokens_used / daily_budget

Example:
  - Agent requests 50k tokens for analysis
  - Caveman saves 15k tokens (compression_ratio = 0.7)
  - Effective tokens = 35k
  - Budget 100k → 65k remaining (not 50k)
  - Feedback: Caveman is performing well, can increase workload
```

---

## Dashboard Panels (Caveman)

### Panel 1: Compression Efficiency (Real-Time)
```
Metrics:
  - caveman_compression_ratio{tool_id} (0.5–1.0, lower is better)
  - caveman_efficiency_score{tool_id} (% bytes saved)
  - caveman_tokens_saved_total (cumulative)

Display: Line chart (ratio over time) + gauge (current efficiency)
Owner: caveman-team@example.com
Alert: compression_ratio > 0.95 (compression failing)
```

### Panel 2: Cost Avoidance (Historical)
```
Metrics:
  - caveman_cost_avoidance_usd_total{tool_id}
  - caveman_bytes_saved_total{tool_id}
  - repomix_tokens_saved + caveman_tokens_saved (unified savings)

Display: Stacked bar chart (cost avoided by tool/agent)
Owner: caveman-team@example.com
Alert: cost_avoidance < threshold (compression underperforming)
```

### Panel 3: Budget Constraints (Recompression Guard)
```
Metrics:
  - caveman_budget_exhausted_total{rule_id}
  - caveman_recompression_guard_activation_rate

Display: Time series (activations per hour) + table (constraints hit)
Owner: caveman-team@example.com
Alert: recompression_guard_activation_rate > 5% (budget too tight)
```

### Panel 4: Profile Performance (By Compression Profile)
```
Metrics:
  - caveman_profile_usage_total{profile}
  - caveman_compression_ratio{profile}
  - caveman_tokens_saved_total{profile}

Display: Bar chart (tokens saved by profile) + line (usage trend)
Owner: caveman-team@example.com
Insight: which profiles are most effective; recommend adoption
```

---

## Observability Schema (Caveman Telemetry)

### Caveman Call Event (JSONL)
```json
{
  "type": "caveman_compression",
  "timestamp": "2026-06-20T10:30:00Z",
  "tool_id": "my_feature",
  "agent_id": "planner",
  "pipeline_stage": "reasoning",
  "bytes_in": 50000,
  "bytes_out": 35000,
  "bytes_saved": 15000,
  "compression_ratio": 0.7,
  "profile": "aggressive",
  "recompression_blocked": false,
  "duration_ms": 45,
  "model": "claude-opus",
  "tokens_equivalent_saved": 3750,
  "cost_avoidance_usd": 0.0375
}
```

### Recompression Guard Event (JSONL)
```json
{
  "type": "caveman_recompression_guard",
  "timestamp": "2026-06-20T10:35:00Z",
  "rule_id": "max_savings_per_op",
  "tool_id": "my_feature",
  "agent_id": "harvester",
  "bytes_requested_savings": 25000,
  "bytes_allowed_savings": 20000,
  "bytes_blocked": 5000,
  "reason": "daily_budget_exhausted",
  "budget_remaining_bytes": 0,
  "recommended_action": "wait_for_next_cycle | increase_budget | redesign_context"
}
```

---

## Metrics to Export (Prometheus)

**Category: Compression Performance**
```
caveman_bytes_in_total{tool_id, agent_id, pipeline_stage, profile}
caveman_bytes_out_total{tool_id, agent_id, pipeline_stage, profile}
caveman_bytes_saved_total{tool_id, agent_id, pipeline_stage, profile}
caveman_compression_ratio{tool_id, agent_id, profile}              # out/in
caveman_efficiency_score{tool_id}                                   # saved/in
caveman_compression_duration_ms{tool_id}                            # latency
```

**Category: Token Equivalents**
```
caveman_tokens_saved_total{tool_id, agent_id}                      # saved tokens
caveman_tokens_saved_equivalent{model}                              # by model (for cost)
caveman_cost_avoidance_usd_total{tool_id, agent_id}                # cost avoided
```

**Category: Budget & Constraints**
```
caveman_budget_exhausted_total{rule_id}                            # constraint violations
caveman_recompression_guard_activations_total{rule_id}             # re-compress blocks
caveman_budget_remaining_bytes{agent_id, date}                     # budget left today
caveman_recompression_guard_activation_rate{rule_id}               # % of ops blocked
```

**Category: Profile Usage**
```
caveman_profile_usage_total{profile, tool_id}                      # times used
caveman_profile_compression_ratio{profile}                         # avg ratio per profile
caveman_profile_tokens_saved_total{profile}                        # cumulative by profile
```

**Category: Integration Metrics**
```
caveman_codeburn_feedback_loop_recommendations{action}             # recommendations generated
caveman_token_economy_budget_utilization{agent_id}                 # % budget used effective
total_token_savings{source}                                        # caveman + repomix combined
cost_avoidance_usd_total{source}                                   # unified cost savings
```

---

## Configuration (Caveman)

### Profiles (Pre-defined compression strategies)
```json
{
  "profiles": {
    "fast": {
      "description": "minimal compression, <5ms latency",
      "redact_unused_sections": true,
      "collapse_whitespace": false,
      "compression_ratio_target": 0.9
    },
    "balanced": {
      "description": "moderate compression, ~15ms latency",
      "redact_unused_sections": true,
      "collapse_whitespace": true,
      "syntax_compress": "basic",
      "compression_ratio_target": 0.75
    },
    "aggressive": {
      "description": "maximum compression, ~45ms latency",
      "redact_unused_sections": true,
      "collapse_whitespace": true,
      "syntax_compress": "advanced",
      "semantic_reorder": true,
      "compression_ratio_target": 0.5
    }
  }
}
```

### Budget Rules
```json
{
  "rules": [
    {
      "rule_id": "max_savings_per_operation",
      "max_bytes_saved_per_op": 20000,
      "window": "1h",
      "action_on_exhaustion": "block_recompression"
    },
    {
      "rule_id": "max_daily_savings",
      "max_bytes_saved_per_day": 1000000,
      "window": "24h",
      "action_on_exhaustion": "fallback_to_fast_profile"
    },
    {
      "rule_id": "cost_avoidance_roi",
      "min_tokens_saved_per_cost": 100,
      "action_on_failure": "skip_compression"
    }
  ]
}
```

---

## Integration Checklist

- [ ] Caveman exports all metrics to Prometheus (caveman_*)
- [ ] JSONL telemetry events emitted (compression + guard)
- [ ] Token equivalent calculation (bytes_saved / 4 → tokens_saved)
- [ ] CodeBurn feedback loop includes Caveman efficiency scores
- [ ] TokenEconomyAgent uses effective token budget (requested - saved)
- [ ] 4 dashboard panels (efficiency, cost avoidance, budget, profile performance)
- [ ] Dashboard unified view: caveman + repomix = total_token_savings
- [ ] Alert rules (compression failing, budget exhausted, ROI low)
- [ ] Roadmap entry: Phase Caveman.X — Dashboard (3 days)

---

## Roadmap Item

**Phase Caveman.X: Dashboard — Compression Observability**
- Criticality: TIER 3
- Days to implement: 3
- Owner: caveman-team@example.com
- Runbook: https://repo/runbooks/caveman.md
- Alert ID: caveman_compression_health
- Metrics: 18 canonical metrics (efficiency, cost, budget, profile)
- Panels: 4 (efficiency, cost avoidance, budget constraints, profile performance)
- Integration: CodeBurn feedback loop, TokenEconomyAgent budget accounting

---

## Notes

- **Caveman is always-on** — compresses every context automatically
- **Savings compound** — 30% compression on 100M tokens = 30M tokens saved = $300 cost avoidance (at $0.01/1k tokens)
- **Budget guards prevent abuse** — recompression limits prevent squeezing every last byte (e.g., at cost of latency)
- **Dashboard shows ROI** — teams can see token/cost savings per tool, per agent
- **Feedback loop is autonomous** — CodeBurn recommends profile changes, TokenEconomyAgent adjusts budgets based on performance
