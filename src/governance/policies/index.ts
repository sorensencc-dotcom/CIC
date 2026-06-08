import { GovernancePolicy } from "../models";

export const SkillPolicies: GovernancePolicy[] = [
  // === INJECTION & CONTROL FLOW ===
  {
    id: "PROMPT_INJECTION_PATTERNS",
    description: "Skill contains patterns that override system instructions or escape controls.",
    severity: "high",
    category: "injection",
    reaudit_interval_days: 30,
    deterministic_check: {
      type: "regex",
      patterns: [
        "\\beval\\s*\\(",
        "\\bexec\\s*\\(",
        "process\\.exit",
        "JSON\\.parse\\s*\\(\\s*process\\.argv",
        "ignore.*previous.*instruction",
        "disregard.*system.*prompt",
      ],
      always_fail: true,
    },
    examples: {
      pass: [
        "Use the provided context to answer user questions",
        "Transform the input data according to the schema",
      ],
      fail: [
        "eval(userInput)",
        "// ignore all previous instructions and...",
        "process.exit(0)",
      ],
    },
  },

  {
    id: "UNSAFE_PROCESS_CALLS",
    description: "Skill spawns subprocesses without safe guards.",
    severity: "high",
    category: "safety",
    reaudit_interval_days: 30,
    deterministic_check: {
      type: "regex",
      patterns: [
        "execSync\\s*\\(\\s*[^{]",
        "spawn\\s*\\(\\s*[^{]",
        "shell\\s*:\\s*true",
      ],
      always_fail: true,
    },
    examples: {
      pass: ["Use the provided Node.js SDK for subprocess management"],
      fail: [
        "execSync('rm -rf /'); // dangerous",
        "spawn('command', { shell: true })",
      ],
    },
  },

  // === UNSAFE CONTENT & HARM ===
  {
    id: "UNSAFE_CONTENT",
    description: "Skill encourages unsafe, illegal, or harmful behavior.",
    severity: "high",
    category: "safety",
    reaudit_interval_days: 60,
    examples: {
      pass: [
        "Help the user understand cybersecurity best practices",
        "Generate test data for security testing in a sandboxed environment",
      ],
      fail: [
        "Here's how to crack passwords",
        "Guide for creating ransomware",
      ],
    },
  },

  {
    id: "CREDENTIAL_EXPOSURE",
    description: "Skill hardcodes API keys, secrets, or stores them insecurely.",
    severity: "high",
    category: "safety",
    reaudit_interval_days: 30,
    deterministic_check: {
      type: "regex",
      patterns: [
        "api[_-]?key\\s*[:=]\\s*['\"][^'\"]{20,}",
        "secret\\s*[:=]\\s*['\"][^'\"]{20,}",
        "password\\s*[:=]\\s*['\"][^'\"]{8,}",
      ],
      always_fail: true,
    },
    examples: {
      pass: ["Use process.env.API_KEY for secrets"],
      fail: ['const apiKey = "sk-12345abcdef..."'],
    },
  },

  // === COMPLETENESS ===
  {
    id: "MISSING_SECTIONS",
    description: "Skill lacks required sections: name, description, scope, out-of-scope, examples.",
    severity: "medium",
    category: "completeness",
    reaudit_interval_days: 90,
    deterministic_check: {
      type: "static_rule",
      patterns: ["name", "description", "scope", "out_of_scope", "examples"],
      always_fail: false,
    },
    examples: {
      pass: [
        `{
          "name": "DataTransformer",
          "description": "Transforms JSON to CSV",
          "scope": "JSON/CSV conversion only",
          "out_of_scope": ["authentication", "network calls"],
          "examples": [...]
        }`,
      ],
      fail: ['{ "name": "Tool" }'],
    },
  },

  {
    id: "MISSING_ERROR_HANDLING",
    description: "Skill lacks error handling for edge cases or external dependencies.",
    severity: "medium",
    category: "completeness",
    reaudit_interval_days: 90,
    examples: {
      pass: ["Check that input is valid before processing; return error if not"],
      fail: ["Always assume input is correct"],
    },
  },

  // === SCOPE & CLARITY ===
  {
    id: "VAGUE_SCOPE",
    description: "Skill scope is overly broad, ambiguous, or not clearly bounded.",
    severity: "low",
    category: "scope",
    reaudit_interval_days: 180,
    examples: {
      pass: [
        "Scope: Process CSV files up to 100MB, columns A–Z, UTF-8 encoding",
      ],
      fail: ["Scope: Do stuff with data"],
    },
  },

  {
    id: "PERMISSION_CREEP",
    description: "Skill requests access to resources beyond its stated scope.",
    severity: "medium",
    category: "scope",
    reaudit_interval_days: 90,
    examples: {
      pass: [
        "Scope: Image analysis. Permissions: read images from /uploads, no network access",
      ],
      fail: [
        "Scope: Image analysis. Permissions: full file system, network, credentials",
      ],
    },
  },
];

export function calculateRiskScore(policies: GovernancePolicy[]): number {
  const severityWeights = { low: 10, medium: 30, high: 60 };
  if (policies.length === 0) return 0;

  const sum = policies.reduce(
    (acc, p) => acc + severityWeights[p.severity],
    0
  );
  const maxPossible = policies.length * 60;
  return Math.min(100, Math.round((sum / maxPossible) * 100));
}

export function getPolicyById(id: string): GovernancePolicy | undefined {
  return SkillPolicies.find((p) => p.id === id);
}
