import { AuditResult, GovernanceContext, Skill, ISO8601 } from "../models";

export interface Database {
  insert(table: string, data: Record<string, unknown>): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

export class SkillLineage {
  constructor(private db: Database) {}

  async record(skill: Skill, audit: AuditResult, ctx: GovernanceContext): Promise<void> {
    const policyIds = audit.policies_triggered.map((p) => p.id);

    await this.db.insert("skill_lineage", {
      skill_id: skill.meta.id,
      skill_name: skill.meta.name,
      skill_version: skill.meta.version,
      source: ctx.source,
      audit_verdict: audit.verdict,
      policies_triggered: JSON.stringify(policyIds),
      risk_score: audit.risk_score,
      audit_timestamp: audit.audit_timestamp,
      auditor_model: audit.auditor_model,
      policy_version: audit.policy_version,
      recorded_at: new Date().toISOString(),
    });
  }

  async getAuditChain(skillId: string): Promise<AuditResult[]> {
    const rows = await this.db.query(
      `SELECT * FROM skill_lineage WHERE skill_id = ? ORDER BY audit_timestamp ASC`,
      [skillId]
    );

    return rows.map((row) => this.rowToAuditResult(row));
  }

  async queryByPolicy(
    policyId: string,
    timeRange?: { start: ISO8601; end: ISO8601 }
  ): Promise<string[]> {
    let query = `SELECT DISTINCT skill_id FROM skill_lineage WHERE policies_triggered LIKE ?`;
    const params: unknown[] = [`%${policyId}%`];

    if (timeRange) {
      query += ` AND audit_timestamp BETWEEN ? AND ?`;
      params.push(timeRange.start, timeRange.end);
    }

    const rows = await this.db.query(query, params);
    return rows.map((r) => r.skill_id as string);
  }

  async detectDrift(
    skillId: string
  ): Promise<{
    has_drift: boolean;
    drift_timeline: {
      audit_timestamp: ISO8601;
      policies_added: string[];
      policies_removed: string[];
      risk_delta: number;
    }[];
  }> {
    const chain = await this.getAuditChain(skillId);

    const drift_timeline = [];
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const curr = chain[i];

      const prev_policies = new Set(prev.policies_triggered.map((p) => p.id));
      const curr_policies = new Set(curr.policies_triggered.map((p) => p.id));

      const added = [...curr_policies].filter((p) => !prev_policies.has(p));
      const removed = [...prev_policies].filter((p) => !curr_policies.has(p));

      if (added.length > 0 || removed.length > 0) {
        drift_timeline.push({
          audit_timestamp: curr.audit_timestamp,
          policies_added: added,
          policies_removed: removed,
          risk_delta: curr.risk_score - prev.risk_score,
        });
      }
    }

    return {
      has_drift: drift_timeline.length > 0,
      drift_timeline,
    };
  }

  private rowToAuditResult(row: Record<string, unknown>): AuditResult {
    // Reconstruct AuditResult from database row
    // Parse policy IDs from JSON string
    let policies_triggered = [];
    if (row.policies_triggered) {
      try {
        const policyIds = JSON.parse(row.policies_triggered as string);
        policies_triggered = policyIds.map((id: string) => ({
          id,
          description: "Policy from lineage",
          severity: "medium" as const,
          category: "governance" as const,
          reaudit_interval_days: 90,
          examples: { pass: [], fail: [] },
        }));
      } catch (e) {
        // If parsing fails, leave as empty array
        policies_triggered = [];
      }
    }

    return {
      skill_id: row.skill_id as string,
      skill_name: row.skill_name as string,
      skill_version: row.skill_version as string,
      source: row.source as "AbsolutelySkilled" | "Local" | "Internal",
      verdict: row.audit_verdict as "PASS" | "WARN" | "FAIL",
      policies_triggered,
      risk_score: row.risk_score as number,
      deterministic_flags: [],
      audit_timestamp: row.audit_timestamp as ISO8601,
      auditor_model: row.auditor_model as "deterministic" | "semantic",
      policy_version: row.policy_version as string,
      audit_duration_ms: 0,
      notes: [],
    };
  }
}
