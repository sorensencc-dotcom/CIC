// SCP Notifier - Phase 28a.6
// Slack webhook integration for skill contribution events
// Events: PR submitted, merged, closed, changes requested

import { Database } from "../db";
import { PRStatusSnapshot, SkillManifestRecord } from "../models";

const log = (skillId: string, msg: string) =>
  console.log(`[SCP-NOTIFIER:${skillId}] ${msg}`);

const logError = (skillId: string, msg: string, error: any) =>
  console.error(`[SCP-NOTIFIER:${skillId}] ERROR: ${msg}`, error);

interface NotifierConfig {
  webhookUrl?: string;
  channel?: string;
  timeout?: number;
}

export class Notifier {
  private webhookUrl: string;
  private channel: string;
  private timeout: number;

  constructor(private db: Database, config?: NotifierConfig) {
    this.webhookUrl = config?.webhookUrl || process.env.SLACK_WEBHOOK_SCP || "";
    this.channel = config?.channel || "#skill-contrib-alerts";
    this.timeout = config?.timeout || 10000;

    if (!this.webhookUrl) {
      throw new Error("Slack webhook URL required (SLACK_WEBHOOK_SCP env var)");
    }
  }

  // Notify: PR submitted
  async notifySubmitted(
    skillId: string,
    skillName: string,
    prNumber: number,
    prUrl: string,
    linesAdded: number,
    linesDeleted: number
  ): Promise<void> {
    try {
      const percentChange = linesAdded + linesDeleted;
      const color = percentChange > 50 ? "warning" : "good";

      const message = {
        channel: this.channel,
        attachments: [
          {
            color,
            title: `📤 Skill Contribution Submitted`,
            fields: [
              {
                title: "Skill",
                value: `\`${skillId}\` - ${skillName}`,
                short: true,
              },
              {
                title: "PR",
                value: `#${prNumber}`,
                short: true,
              },
              {
                title: "Changes",
                value: `+${linesAdded} -${linesDeleted} lines`,
                short: true,
              },
              {
                title: "Impact",
                value: `${percentChange} lines changed`,
                short: true,
              },
            ],
            actions: [
              {
                type: "button",
                text: "View PR",
                url: prUrl,
              },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      await this.sendWebhook(skillId, message);
      log(skillId, `Submitted notification sent (PR #${prNumber})`);
    } catch (error) {
      logError(skillId, "Failed to send submitted notification", error);
      // Non-fatal: don't throw
    }
  }

  // Notify: PR merged
  async notifyMerged(
    skillId: string,
    skillName: string,
    prNumber: number,
    prUrl: string,
    mergedAt: string
  ): Promise<void> {
    try {
      const message = {
        channel: this.channel,
        attachments: [
          {
            color: "good",
            title: `✅ Skill Contribution Merged`,
            fields: [
              {
                title: "Skill",
                value: `\`${skillId}\` - ${skillName}`,
                short: true,
              },
              {
                title: "PR",
                value: `#${prNumber}`,
                short: true,
              },
              {
                title: "Merged At",
                value: new Date(mergedAt).toISOString(),
                short: true,
              },
            ],
            actions: [
              {
                type: "button",
                text: "View PR",
                url: prUrl,
              },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      await this.sendWebhook(skillId, message);
      log(skillId, `Merged notification sent (PR #${prNumber})`);
    } catch (error) {
      logError(skillId, "Failed to send merged notification", error);
      // Non-fatal: don't throw
    }
  }

  // Notify: Changes requested
  async notifyChangesRequested(
    skillId: string,
    skillName: string,
    prNumber: number,
    prUrl: string,
    reviewComments: number
  ): Promise<void> {
    try {
      const message = {
        channel: this.channel,
        attachments: [
          {
            color: "warning",
            title: `⚠️  Changes Requested`,
            fields: [
              {
                title: "Skill",
                value: `\`${skillId}\` - ${skillName}`,
                short: true,
              },
              {
                title: "PR",
                value: `#${prNumber}`,
                short: true,
              },
              {
                title: "Review Comments",
                value: String(reviewComments),
                short: true,
              },
            ],
            actions: [
              {
                type: "button",
                text: "Review Changes",
                url: prUrl,
              },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      await this.sendWebhook(skillId, message);
      log(skillId, `Changes-requested notification sent (PR #${prNumber})`);
    } catch (error) {
      logError(skillId, "Failed to send changes-requested notification", error);
      // Non-fatal: don't throw
    }
  }

  // Notify: PR closed without merge
  async notifyClosed(
    skillId: string,
    skillName: string,
    prNumber: number,
    prUrl: string
  ): Promise<void> {
    try {
      const message = {
        channel: this.channel,
        attachments: [
          {
            color: "danger",
            title: `❌ Skill Contribution Closed`,
            fields: [
              {
                title: "Skill",
                value: `\`${skillId}\` - ${skillName}`,
                short: true,
              },
              {
                title: "PR",
                value: `#${prNumber}`,
                short: true,
              },
            ],
            actions: [
              {
                type: "button",
                text: "View PR",
                url: prUrl,
              },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      await this.sendWebhook(skillId, message);
      log(skillId, `Closed notification sent (PR #${prNumber})`);
    } catch (error) {
      logError(skillId, "Failed to send closed notification", error);
      // Non-fatal: don't throw
    }
  }

  // Send webhook to Slack
  private async sendWebhook(skillId: string, payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const https = require("https");
      const url = new URL(this.webhookUrl);

      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        timeout: this.timeout,
      };

      const req = https.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `Slack webhook failed: HTTP ${res.statusCode} - ${data}`
              )
            );
          }
        });
        res.on("error", reject);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Slack webhook timeout after ${this.timeout}ms`));
      });

      req.on("error", reject);

      req.write(JSON.stringify(payload));
      req.end();
    });
  }
}
