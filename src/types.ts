import type { Client } from "@modelcontextprotocol/client";

/** How loudly a rule speaks when it fires. `off` disables it entirely. */
export type Severity = "error" | "warn" | "off";

/** Preset rule-severity bundles, selectable with `conformance:` in the config. */
export type Profile = "strict" | "recommended" | "off";

export type RuleCategory = "protocol" | "tools" | "resources" | "prompts" | "hygiene";

/**
 * A single thing that went wrong, anchored to the part of the server that
 * produced it (`target` is a tool name, resource URI, prompt name, ...).
 */
export interface Finding {
  rule: string;
  severity: Exclude<Severity, "off">;
  message: string;
  target?: string;
  /** JSON-pointer-ish path inside the target, e.g. `inputSchema.properties.q`. */
  path?: string;
  hint?: string;
}

export interface RuleResult {
  findings: Finding[];
  /** Free-form numbers surfaced in the report footer (token counts, timings). */
  stats?: Record<string, number>;
}

/**
 * Everything a rule is allowed to look at. Rules never reconnect or spawn
 * anything themselves — the runner hands them an already-initialized server.
 */
export interface RuleContext {
  client: Client;
  tools: ToolLike[];
  resources: ResourceLike[];
  prompts: PromptLike[];
  capabilities: Record<string, unknown> | undefined;
  serverInfo: { name?: string; version?: string } | undefined;
  /** Wall-clock milliseconds from process spawn to a completed `initialize`. */
  startupMs: number;
  /** Transport-level errors observed during the session. */
  transportErrors: string[];
  /** stdio only — stdout lines that were not JSON-RPC frames. */
  junkLines: string[];
  /** stdio only — anything the server printed to stderr. */
  stderr: string;
  /** Token ceiling for the tool list; undefined disables the budget check. */
  contextBudget: number | undefined;
  /** Milliseconds allowed for `initialize`. */
  startupBudget: number;
}

export interface Rule {
  name: string;
  category: RuleCategory;
  /** One line, shown by `mcp-spec rules`. */
  description: string;
  /** Severity when the profile is `recommended`; `strict` promotes warn to error. */
  defaultSeverity: Exclude<Severity, "off">;
  /** Skip when the server does not declare the capability this rule needs. */
  requires?: "tools" | "resources" | "prompts";
  run(ctx: RuleContext): Promise<RuleResult> | RuleResult;
}

export interface ToolLike {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ResourceLike {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  [k: string]: unknown;
}

export interface PromptLike {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface StdioTarget {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTarget {
  url: string;
  headers?: Record<string, string>;
}

export type ServerTarget = StdioTarget | HttpTarget;

export function isHttpTarget(t: ServerTarget): t is HttpTarget {
  return typeof (t as HttpTarget).url === "string";
}

/**
 * An expectation on one value. A bare scalar means deep equality; the object
 * form opts into a comparison operator.
 */
export type Matcher =
  | string
  | number
  | boolean
  | null
  | {
      equals?: unknown;
      contains?: string;
      matches?: string;
      exists?: boolean;
      type?: "string" | "number" | "boolean" | "object" | "array" | "null";
      gt?: number;
      lt?: number;
      length?: number;
    };

export interface BehaviorTest {
  name?: string;
  /** Exactly one of these selects what to exercise. */
  tool?: string;
  resource?: string;
  prompt?: string;
  input?: Record<string, unknown>;
  args?: Record<string, string>;
  /** Map of value path -> expectation, e.g. `content.0.text: { contains: "hi" }`. */
  expect?: Record<string, Matcher>;
  /** Assert the call fails. `true` accepts any error; a string must be contained. */
  expectError?: boolean | string;
  timeout?: number;
}

export interface Config {
  server: ServerTarget;
  conformance?: Profile;
  /** Per-rule severity overrides, applied on top of the profile. */
  rules?: Record<string, Severity>;
  tests?: BehaviorTest[];
  /** Fail if the tool list is estimated to cost more than this many tokens. */
  contextBudget?: number;
  /** Milliseconds allowed for `initialize` before `hygiene/startup-time` fires. */
  startupBudget?: number;
  timeout?: number;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  /** Populated on failure so the reporter can show path-level diffs. */
  failures?: Array<{ path: string; expected: string; actual: string }>;
}

export interface RunResult {
  ok: boolean;
  target: string;
  serverInfo: { name?: string; version?: string } | undefined;
  startupMs: number;
  conformance: {
    profile: Profile;
    evaluated: number;
    passed: number;
    findings: Finding[];
  };
  behavior: TestResult[];
  stats: Record<string, number>;
  counts: { errors: number; warnings: number; failedTests: number };
}
