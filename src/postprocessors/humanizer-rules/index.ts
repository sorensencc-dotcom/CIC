import { HumanizerRule } from "../../interfaces/postprocessor";
import { TIER1_RULES } from "./tier1";
import { TIER2_RULES } from "./tier2";

export { TIER1_RULES, TIER2_RULES };

export const ALL_RULES_BY_ID = new Map<number, HumanizerRule>([
  ...TIER1_RULES.map((rule) => [rule.id, rule] as const),
  ...TIER2_RULES.map((rule) => [rule.id, rule] as const),
]);

export function getActiveRules(profile: "default" | "rewrite-labs" | "custom", ruleTiers?: Record<string, boolean>): HumanizerRule[] {
  if (profile === "default") {
    return TIER1_RULES;
  }
  if (profile === "rewrite-labs") {
    return [...TIER1_RULES, ...TIER2_RULES];
  }
  if (profile === "custom" && ruleTiers) {
    const rules: HumanizerRule[] = [];
    if (ruleTiers.tier1) rules.push(...TIER1_RULES);
    if (ruleTiers.tier2) rules.push(...TIER2_RULES);
    return rules;
  }
  return TIER1_RULES;
}

export function getRulesByTier(tier: number): HumanizerRule[] {
  if (tier === 1) return TIER1_RULES;
  if (tier === 2) return TIER2_RULES;
  return [];
}
