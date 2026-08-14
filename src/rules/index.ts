import type { Profile, Rule, Severity } from "../types.js";
import { protocolRules } from "./protocol.js";
import { toolRules } from "./tools.js";
import { promptRules, resourceRules } from "./resources.js";
import { hygieneRules } from "./hygiene.js";

export const allRules: Rule[] = [
  ...protocolRules,
  ...toolRules,
  ...resourceRules,
  ...promptRules,
  ...hygieneRules,
];

export function getRule(name: string): Rule | undefined {
  return allRules.find((r) => r.name === name);
}

/**
 * Resolves the severity a rule runs at.
 *
 * `strict` promotes every warning to an error, `recommended` uses each rule's
 * own default, `off` disables the catalog. An explicit entry in `rules:`
 * always wins, so a project can opt back into a single check under `off`.
 */
export function resolveSeverity(
  rule: Rule,
  profile: Profile,
  overrides: Record<string, Severity> = {},
): Severity {
  const explicit = overrides[rule.name] ?? overrides[`${rule.category}/*`];
  if (explicit) return explicit;
  if (profile === "off") return "off";
  if (profile === "strict") return "error";
  return rule.defaultSeverity;
}

export { protocolRules, toolRules, resourceRules, promptRules, hygieneRules };
