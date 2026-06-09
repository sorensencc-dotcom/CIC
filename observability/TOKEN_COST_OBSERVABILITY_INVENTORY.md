# Token & Cost Observability Inventory

**Scope:** Real-time token tracking + CodeBurn historical observability + Repomix cost accounting  
**Integration:** Caveman (compression) + TokenEconomyAgent (routing) + CodeBurn (telemetry) + Repomix (token counting)

---

## Core Components (Backend Priority)

### Phase 4.3: CodeBurn Integration ✅ (PLANNED 2026-06-07–14)

**Telemetry Emitters**
- `src/cic/telemetry/emitter.ts` — LLM call, routing decision, cost events
- `src/rewrite-labs/telemetry/emitter.ts` — Session, stage, conversion events
- Output: append-only JSONL to `~/.cic/logs/telemetry/` and `~/.rewrite-labs/logs/telemetry/`
- Retention: 90 days

**Telemetry Events (to emit metrics from)**
```
cic_telemetry_schema.yaml:
  - llm_call: {model, prompt_tokens, completion_tokens, cost, latency_ms, status}
  - routing_decision: {agent, model_choice, reason, budget_remaining, success_rate}
  - cost_event: {pipeline, phase, model, tokens_used, cost_usd, cumulative_cost}

rewrite_labs_schema.yaml:
  - redesign_session: {session_id, tenant_id, repo_complexity, status}
  - stage_event: {session_id, stage, tokens_used, model, cost_usd}
  - conversion_event: {session_id, result_quality, cost_efficiency, model_score}
```

**CodeBurn Provider Plugin**
- `src/codeburn/providers/cic_provider.ts` — normalizes telemetry for CodeBurn
- Aggregates by: model, agent, pipeline, tenant
- Calculates: cost_per_model, success_rate, retry_rate, token_efficiency
- Exports to CodeBurn for historical analysis

**Feedback Loop**
- `src/token-economy/feedback_loop.ts` — runs hourly
- Generates routing rule recommendations
- Updates `config/token-economy/routing_rules.json` with ≥85% confidence recommendations
- Metrics: recommendation_confidence, cost_reduction_percent, reliability_improvement

**Routing Rules (JSON)**
```
config/token-economy/routing_rules.json:
  5 rules: harvester, redesign, outreach, analysis, fallback
  Each rule: match_conditions, model, max_tokens, budget_class
  Constraints: max_daily_tokens, max_daily_cost_usd, min_success_rate
```

**Metrics to Export**
```
codeburn_llm_call_total{model,agent,status}                      # total LLM calls
codeburn_tokens_used_total{model,agent,pipeline}                 # cumulative tokens
codeburn_cost_usd_total{model,agent,pipeline,tenant}             # cumulative cost
codeburn_model_success_rate{model}                                # success %
codeburn_model_retry_rate{model}                                  # retry %
codeburn_routing_decision_total{model,agent,reason}              # routing choices
codeburn_feedback_loop_recommendation_total{confidence,action}    # recommendations
codeburn_daily_token_budget_used_percent{agent}                   # budget utilization
codeburn_cost_reduction_percent{pipeline}                         # optimization gain
```

**Environment Variables**
- `CIC_TELEMETRY_DIR` — default: `~/.cic/logs/telemetry`
- `REWRITE_LABS_TELEMETRY_DIR` — default: `~/.rewrite-labs/logs/telemetry`
- `CODEBURN_EXPORT_PATH` — default: `~/.codeburn/exports/cic_telemetry.json`
- `ROUTING_RULES_PATH` — default: `config/token-economy/routing_rules.json`

---

### Phase 4.4: Repomix Integration ✅ (PLANNED 2026-06-07–14)

**Repository Ingestion (Token-Aware)**
- `src/rewrite-labs/repository-ingestion/RepositoryIngestion.ts` — ingest repos deterministically
- Outputs: JSON with per-file token counts
- Token compression: 30–50% via Tree-sitter
- Secret detection: fail-fast on credential leaks

**Token Accounting**
- Per-file token counts (before/after compression)
- Compression ratio per file + per repo
- Total ingestion cost (tokens × model_rate)
- Per-tenant cost aggregation

**Metrics to Export**
```
repomix_repo_ingest_total{tenant,status}                       # repos ingested
repomix_files_ingested_total{tenant,repo}                       # files per repo
repomix_tokens_before_compression_total{tenant,repo}            # raw token count
repomix_tokens_after_compression_total{tenant,repo}             # compressed tokens
repomix_compression_ratio{tenant,repo}                          # after/before
repomix_ingestion_cost_usd{tenant,repo}                         # cost (tokens × rate)
repomix_secret_detection_total{status}                          # secrets found/blocked
repomix_dependency_complexity_score{repo}                       # framework complexity
repomix_determinism_crc32_matches_percent                       # reproducibility
```

**Integration with CodeBurn**
- Ingestion cost → CodeBurn telemetry
- Token budget usage → TokenEconomyAgent
- Cost per tenant → billing dashboard

---

### TokenEconomyAgent (Real-Time Routing)

**Components**
- Monitors daily token budget per agent/pipeline
- Consumes CodeBurn feedback loop recommendations
- Makes model routing decisions (which LLM, max tokens)
- Enforces constraints: max_daily_tokens, max_daily_cost_usd, min_success_rate

**Metrics to Export**
```
token_economy_routing_decision_total{agent,model,reason}        # routing choices
token_economy_budget_remaining_tokens{agent}                     # budget left
token_economy_daily_cost_usd{agent,pipeline}                     # daily spend
token_economy_model_score{model}                                 # composite score
token_economy_constraint_violation_total{constraint}             # budget/cost/reliability
token_economy_recommendation_acceptance_rate{source}             # feedback loop trust
```

---

## Caveman Integration (Compression + Telemetry)

**How Caveman blends with CodeBurn/Token tracking:**

1. **Compression Metrics** (already in COMMAND-CENTER-PRIORITY-MATRIX)
   - `caveman_bytes_in_total`, `caveman_bytes_out_total`, `caveman_bytes_saved_total`
   - `caveman_compression_ratio`, `caveman_profile_usage_total`

2. **Token Equivalent Accounting**
   - If Caveman saves N bytes, that's ~N/4 tokens saved (rough estimate)
   - Combined metric: `caveman_tokens_saved_equivalent`
   - Attributes to "cost reduction" in CodeBurn feedback loop

3. **Cross-System Metrics**
   ```
   caveman_tokens_saved_equivalent = caveman_bytes_saved_total / 4
   total_token_savings = caveman_tokens_saved + repomix_tokens_saved
   cost_per_operation = (tokens_used - token_savings) × model_rate_usd_per_1k_tokens
   ```

---

## CLI Token Tracking (Missing from Current Inventory)

**Entry Points to Instrument**

1. **`cic-cli` Tool**
   - `cic-cli run` commands emit: tokens_used, cost, model_routed_to
   - Examples: `cic-cli run-abb plan`, `cic-cli run-abb execute`
   - Metrics:
     ```
     cli_command_total{command,status}
     cli_tokens_used_total{command,model}
     cli_cost_usd_total{command}
     cli_execution_latency_seconds{command}
     ```

2. **Claude Code CLI Integration**
   - If Claude Code calls CIC APIs: track tokens+cost
   - Metrics:
     ```
     claude_code_cic_call_total{operation}
     claude_code_tokens_used_total{operation}
     claude_code_cost_usd_total{operation}
     ```

3. **Rewrite Labs CLI**
   - `rewrite-labs redesign`, `rewrite-labs harvest`, `rewrite-labs analyze`
   - Emit token usage + model routing decisions
   - Metrics:
     ```
     rewrite_labs_command_total{command,status}
     rewrite_labs_tokens_used_total{command,model}
     rewrite_labs_cost_usd_total{command}
     ```

---

## Unified Cost Dashboard Panels (Proposed)

**Panel 1: Token Budget & Spend (Real-Time)**
- Daily token budget remaining (per agent, per pipeline)
- Daily cost YTD
- Routing efficiency (% requests that stayed under budget)

**Panel 2: Model Performance & Cost**
- Cost per model (claude-opus, claude-sonnet, claude-haiku)
- Success rate by model
- Average tokens per request
- Cost per successful request

**Panel 3: Compression Savings (Caveman + Repomix)**
- Bytes saved (Caveman)
- Tokens saved (Repomix + Caveman equivalent)
- Cost avoided (tokens_saved × model_rate)

**Panel 4: Feedback Loop Recommendations**
- Recommendations generated (per hour)
- Acceptance rate (% adopted)
- Cost reduction achieved (per recommendation)

**Panel 5: Routing Decisions (TokenEconomyAgent)**
- Decisions by model + reason
- Constraint violations (budget exceeded, cost exceeded, reliability low)
- Manual overrides (operator decisions vs. agent decisions)

**Panel 6: Cost Efficiency Trends**
- Cost per token over time
- Model cost comparison (claude-opus vs. sonnet vs. haiku)
- Efficiency by pipeline (harvester, redesign, analysis)

---

## Roadmap Items (Token/Cost Observability)

| Phase | Title | Criticality | Days | Owner |
|-------|-------|-------------|------|-------|
| 4.3.X | Dashboard: CodeBurn Token Tracking | TIER 2 | 5 | codeburn-team |
| 4.4.X | Dashboard: Repomix Ingestion Cost | TIER 2 | 4 | repomix-team |
| TokenEcon.X | Dashboard: TokenEconomyAgent Routing | TIER 2 | 5 | token-econ-team |
| Caveman.X | Dashboard: Compression Savings | TIER 3 | 3 | caveman-team |
| CLI.X | Dashboard: CLI Token Usage | TIER 3 | 3 | cli-team |

---

## Metrics Summary (All to be exported to Prometheus)

**Total new metrics:** 35+ canonical metric names

**Breakdown:**
- CodeBurn telemetry: 8 metrics (llm calls, costs, success/retry, routing, feedback)
- Repomix ingestion: 8 metrics (files, tokens, compression, cost, secrets, complexity, determinism)
- TokenEconomyAgent: 6 metrics (routing, budget, cost, model score, constraints, acceptance)
- Caveman integration: 1 equivalent metric (tokens_saved_equivalent)
- CLI tracking: 6+ metrics (command volume, tokens, cost, latency)

**Cross-System Derived Metrics:**
- `total_token_savings` = caveman_tokens_saved + repomix_tokens_saved
- `cost_per_operation` = (tokens_used - token_savings) × model_rate
- `efficiency_score` = tokens_saved / tokens_used
- `roi_percent` = cost_savings / cost_spent

---

## Integration Checklist

- [ ] CodeBurn telemetry emitters (Phase 4.3)
- [ ] CodeBurn provider plugin
- [ ] TokenEconomyAgent metrics export
- [ ] Repomix token counting + export
- [ ] Caveman token equivalent calculation
- [ ] CLI token tracking instrumentation
- [ ] Prometheus scrape configuration
- [ ] Grafana dashboard panels (6 main panels)
- [ ] Roadmap entries (5 phases for dashboard implementation)
- [ ] Alert rules (budget exceeded, cost spike, routing failure)

---

## Notes

- **Backend first:** token tracking infrastructure is already planned (Phases 4.3–4.4, TokenEconomyAgent)
- **Dashboard follows:** once telemetry emitters are live, metrics are available for dashboard visualization
- **Caveman + Repomix synergy:** both contribute to "total token savings"; dashboard should show unified view
- **CLI is the missing piece:** instrument CLI tools to capture user-facing token usage
- **CodeBurn feedback loop:** auto-generates routing recommendations; dashboard should show acceptance + impact
