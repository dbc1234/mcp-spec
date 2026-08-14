export { run } from "./run.js";
export { connect, describeTarget, ConnectError } from "./connect.js";
export { loadConfig, findConfig, validateConfig, ConfigError } from "./config.js";
export { allRules, getRule, resolveSeverity } from "./rules/index.js";
export { checkExpectations, resolvePath } from "./behavior/assert.js";
export { formatPretty } from "./report/pretty.js";
export { formatJUnit } from "./report/junit.js";
export type {
  BehaviorTest,
  Config,
  Finding,
  Matcher,
  Profile,
  Rule,
  RuleContext,
  RuleResult,
  RunResult,
  Severity,
  TestResult,
} from "./types.js";
