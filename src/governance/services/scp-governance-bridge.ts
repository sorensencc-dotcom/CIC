// SCP → Governance Bridge
// Integrates skill contributions into governance vault (Phase 24.5 prep)
// Records contribution events in skill_lineage for audit trail

import { Database } from "../db";
import { SkillContribution, AuditResult } from "../models";

export class SCPGovernanceBridge {
  constructor(private db: Database) {}

  /**
   * Record a skill contribution event in the governance audit trail.
   * Called when a PR is submitted, merged, or closed.
   * Feeds into Phase 24.5 Build Governance Integration vault.
   * @throws Error on database constraint violation or connection failure
   */
  async recordContributionEvent(
    contrib: SkillContribution,
    event: "submitted" | "merged" | "closed"
  ): Promise<number> {
    try {
      const riskScore = this.calculateContributionRisk(contrib);

      const auditRecord = `
        INSERT INTO skill_lineage (
          skill_id, skill_name, skill_version,
          source, audit_verdict, policies_triggered,
          risk_score, audit_timestamp, auditor_model,
          policy_version, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      const verdict = event === "merged" ? "PASS" : event === "submitted" ? "WARN" : "FAIL";

      const result = await this.db.execute(auditRecord, [
        contrib.skillId,
        contrib.skillName,
        "1.0.0",
        "SCP-Contribution",
        verdict,
        JSON.stringify([`SCP_CONTRIB_${event.toUpperCase()}`]),
        riskScore,
        new Date().toISOString(),
        "deterministic",
        "28a.2",
      ]);

      return result.insertId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `[SCPGovernanceBridge] Failed to record event for skill ${contrib.skillId}: ${msg}`
      );
      throw error;
    }
  }

  /**
   * Calculate risk score for a contribution.
   * Used for governance decisions on auto-approval vs manual review.
   */
  private calculateContributionRisk(contrib: SkillContribution): number {
    let riskScore = 0;

    // High risk: large changes
    if (contrib.description && contrib.description.length > 500) {
      riskScore += 0.3;
    }

    // Medium risk: certain types
    if (["feature", "error-handling"].includes(contrib.type)) {
      riskScore += 0.2;
    }

    // Low risk: perf optimizations, small changes
    if (contrib.type === "perf-optimization") {
      riskScore -= 0.1;
    }

    // Risk: not yet merged (pending review)
    if (contrib.status === "open") {
      riskScore += 0.15;
    }

    // Reward: already merged upstream
    if (contrib.status === "merged") {
      riskScore -= 0.2;
    }

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, riskScore));
  }

  /**
   * Query contributions by governance verdict.
   * Used by Phase 24 council voting for approval decisions.
   */
  async queryContributionsByVerdict(
    verdict: "PASS" | "WARN" | "FAIL"
  ): Promise<any[]> {
    const query = `
      SELECT
        skill_lineage.id,
        skill_lineage.skill_id,
        skill_lineage.skill_name,
        skill_lineage.audit_verdict,
        skill_lineage.risk_score,
        skill_lineage.audit_timestamp,
        skill_contributions.pr_number,
        skill_contributions.pr_url,
        skill_contributions.status
      FROM skill_lineage
      LEFT JOIN skill_contributions
        ON skill_lineage.skill_id = skill_contributions.skill_id
      WHERE skill_lineage.audit_verdict = ?
        AND skill_lineage.source = 'SCP-Contribution'
      ORDER BY skill_lineage.audit_timestamp DESC
    `;

    return this.db.query(query, [verdict]);
  }

  /**
   * Link a contribution to its governance audit record.
   * Used by Phase 24.5 to create full lineage chain:
   * Build → Lineage (skill_lineage) → Contribution (skill_contributions)
   * @throws Error on database failure or record not found
   */
  async linkContributionToLineage(
    skillId: string,
    prNumber: number,
    lineageId: number
  ): Promise<void> {
    try {
      const query = `
        UPDATE skill_contributions
        SET linked_skill_lineage_id = ?
        WHERE skill_id = ? AND pr_number = ?
      `;

      const result = await this.db.execute(query, [lineageId, skillId, prNumber]);

      if (result.affectedRows === 0) {
        throw new Error(
          `Contribution not found: skill_id=${skillId}, pr_number=${prNumber}`
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `[SCPGovernanceBridge] Failed to link contribution ${skillId}#${prNumber}: ${msg}`
      );
      throw error;
    }
  }
}
