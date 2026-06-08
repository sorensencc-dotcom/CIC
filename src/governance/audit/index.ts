import { AuditResult, GovernanceContext, GovernanceVerdict, Skill } from "../models";
import { SkillPolicies, calculateRiskScore } from "../policies";
import { DeterministicAudit } from "./deterministic";
import { AuditCache } from "./cache";

export class SkillAudit {
  private deterministic: DeterministicAudit;

  constructor(
    private cache: AuditCache,
    private policyVersion: string = "2.0"
  ) {
    this.deterministic = new DeterministicAudit();
  }

  async audit(skill: Skill, ctx: GovernanceContext): Promise<AuditResult> {
    const startTime = Date.now();

    // 1. Check cache (unless force_reaudit)
    if (!ctx.force_reaudit) {
      const cached = await this.cache.get(
        skill.meta.id,
        skill.meta.version,
        this.policyVersion
      );
      if (cached && !cached.isStale()) {
        return cached.result;
      }
    }

    // 2. Run deterministic checks
    const { hard_fails, flags } = this.deterministic.check(
      skill.content,
      SkillPolicies
    );

    // 3. Determine verdict
    const verdict = this.determineVerdict(hard_fails, flags);

    // 4. Build result
    const result = this.buildAuditResult(
      skill,
      ctx,
      hard_fails,
      flags,
      verdict,
      Date.now() - startTime
    );

    // 5. Cache result
    await this.cache.set(result, this.policyVersion);

    return result;
  }

  private determineVerdict(
    hard_fails: typeof SkillPolicies,
    flags: typeof SkillPolicies
  ): GovernanceVerdict {
    if (hard_fails.length > 0) return "FAIL";
    if (flags.length > 0) return "WARN";
    return "PASS";
  }

  private buildAuditResult(
    skill: Skill,
    ctx: GovernanceContext,
    hard_fails: typeof SkillPolicies,
    flags: typeof SkillPolicies,
    verdict: GovernanceVerdict,
    duration_ms: number
  ): AuditResult {
    const all_triggered = [...hard_fails, ...flags];
    const risk_score = calculateRiskScore(all_triggered);

    return {
      skill_id: skill.meta.id,
      skill_name: skill.meta.name,
      skill_version: skill.meta.version,
      source: ctx.source,
      verdict,
      policies_triggered: all_triggered,
      risk_score,
      deterministic_flags: all_triggered.map((p) => ({
        policy_id: p.id,
        severity: p.severity,
        check_type: p.deterministic_check?.type || "none",
        matched_pattern: undefined,
      })),
      audit_timestamp: new Date().toISOString(),
      auditor_model: "deterministic",
      policy_version: this.policyVersion,
      audit_duration_ms: duration_ms,
      notes: [
        `Deterministic audit: ${hard_fails.length} hard fails, ${flags.length} flags`,
      ],
    };
  }
}

export { DeterministicAudit };
export { AuditCache };
export type { CacheClient } from "./cache";
