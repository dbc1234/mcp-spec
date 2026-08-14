import type { Client } from "@modelcontextprotocol/client";
import { connect, describeTarget, withTimeout } from "./connect.js";
import { allRules, resolveSeverity } from "./rules/index.js";
import { checkExpectations } from "./behavior/assert.js";
import { rawRequest } from "./raw.js";
import type {
  BehaviorTest,
  Config,
  Finding,
  PromptLike,
  ResourceLike,
  RuleContext,
  RunResult,
  TestResult,
  ToolLike,
} from "./types.js";

/** Stop following `nextCursor` after this many pages — a loop here would hang CI. */
const MAX_PAGES = 50;

export async function run(config: Config): Promise<RunResult> {
  const session = await connect(config.server, { timeout: config.timeout });
  try {
    const capabilities = session.client.getServerCapabilities() as Record<string, unknown> | undefined;

    const [tools, resources, prompts] = await Promise.all([
      capabilities?.tools ? listAll<ToolLike>(session.client, "tools") : Promise.resolve([]),
      capabilities?.resources ? listAll<ResourceLike>(session.client, "resources") : Promise.resolve([]),
      capabilities?.prompts ? listAll<PromptLike>(session.client, "prompts") : Promise.resolve([]),
    ]);

    const ctx: RuleContext = {
      client: session.client,
      tools,
      resources,
      prompts,
      capabilities,
      serverInfo: session.client.getServerVersion(),
      startupMs: session.startupMs,
      transportErrors: session.transportErrors,
      // Live rather than snapshotted. stdout and stderr are separate pipes
      // with no ordering guarantee against the response that triggered them,
      // so a server that logs inside its `tools/list` handler can have its
      // response processed before the log data event fires. Snapshotting here
      // silently loses whatever is still in flight.
      get junkLines() {
        return session.junkLines();
      },
      get stderr() {
        return session.stderr();
      },
      contextBudget: config.contextBudget,
      startupBudget: config.startupBudget ?? 5000,
    };

    const profile = config.conformance ?? "recommended";
    const findings: Finding[] = [];
    const stats: Record<string, number> = {};
    let evaluated = 0;
    let passed = 0;

    let drained = false;
    for (const rule of allRules) {
      const severity = resolveSeverity(rule, profile, config.rules);
      if (severity === "off") continue;

      // The hygiene rules read the output streams, so they run once everything
      // else has finished talking to the server — and only after giving the
      // pipes a beat to deliver whatever the last request produced.
      if (rule.category === "hygiene" && !drained) {
        drained = true;
        await drainPipes();
      }
      // A rule that needs a primitive the server does not offer is skipped
      // rather than failed — an absent capability is a legitimate design.
      if (rule.requires && !capabilities?.[rule.requires]) continue;

      evaluated++;
      let produced: Finding[];
      try {
        const result = await rule.run(ctx);
        produced = result.findings;
        Object.assign(stats, result.stats ?? {});
      } catch (err) {
        produced = [
          {
            rule: rule.name,
            severity: "warn",
            message: `rule threw while evaluating: ${message(err)}`,
          },
        ];
      }
      if (produced.length === 0) passed++;
      for (const f of produced) findings.push({ ...f, severity });
    }

    const behavior: TestResult[] = [];
    for (const test of config.tests ?? []) {
      behavior.push(await runTest(session.client, test, config.timeout ?? 30_000));
    }

    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.filter((f) => f.severity === "warn").length;
    const failedTests = behavior.filter((t) => !t.passed).length;

    return {
      ok: errors === 0 && failedTests === 0,
      target: describeTarget(config.server),
      serverInfo: ctx.serverInfo,
      startupMs: session.startupMs,
      conformance: { profile, evaluated, passed, findings },
      behavior,
      stats: { ...stats, startupMs: session.startupMs },
      counts: { errors, warnings, failedTests },
    };
  } finally {
    await session.close();
  }
}

async function runTest(client: Client, test: BehaviorTest, defaultTimeout: number): Promise<TestResult> {
  const name = test.name ?? describeTest(test);
  const timeout = test.timeout ?? defaultTimeout;
  const started = Date.now();

  let result: unknown;
  try {
    result = await withTimeout(invoke(client, test, timeout), timeout, `timed out after ${timeout}ms`);
  } catch (err) {
    const durationMs = Date.now() - started;
    if (test.expectError !== undefined && test.expectError !== false) {
      const needle = typeof test.expectError === "string" ? test.expectError : null;
      if (!needle || message(err).includes(needle)) {
        return { name, passed: true, durationMs };
      }
      return {
        name,
        passed: false,
        durationMs,
        error: `expected the error to contain ${JSON.stringify(needle)}, got: ${message(err)}`,
      };
    }
    return { name, passed: false, durationMs, error: message(err) };
  }

  const durationMs = Date.now() - started;

  // A tool that reports failure in-band still resolves, so `expectError` has to
  // consider `isError` too.
  const inBandError = isRecord(result) && result.isError === true;
  if (test.expectError !== undefined && test.expectError !== false) {
    if (!inBandError) {
      return { name, passed: false, durationMs, error: "expected the call to fail, but it succeeded" };
    }
    const needle = typeof test.expectError === "string" ? test.expectError : null;
    if (needle && !JSON.stringify(result).includes(needle)) {
      return {
        name,
        passed: false,
        durationMs,
        error: `expected the error to contain ${JSON.stringify(needle)}`,
      };
    }
    return { name, passed: true, durationMs };
  }

  const failures = checkExpectations(result, test.expect ?? {});
  if (failures.length > 0) {
    return { name, passed: false, durationMs, failures };
  }
  return { name, passed: true, durationMs };
}

function invoke(client: Client, test: BehaviorTest, timeout: number): Promise<unknown> {
  // Raw throughout: an assertion should report what the server returned, not
  // die inside the client's result validation.
  if (test.tool !== undefined) {
    return rawRequest(client, "tools/call", { name: test.tool, arguments: test.input ?? {} }, timeout);
  }
  if (test.resource !== undefined) {
    return rawRequest(client, "resources/read", { uri: test.resource }, timeout);
  }
  return rawRequest(client, "prompts/get", { name: test.prompt!, arguments: test.args ?? {} }, timeout);
}

function describeTest(test: BehaviorTest): string {
  if (test.tool) return `tool ${test.tool}`;
  if (test.resource) return `resource ${test.resource}`;
  return `prompt ${test.prompt}`;
}

/** Follows `nextCursor` so paginated servers are fully covered. */
async function listAll<T>(client: Client, kind: "tools" | "resources" | "prompts"): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = (await rawRequest(
      client,
      `${kind}/list`,
      cursor ? { cursor } : {},
    )) as Record<string, unknown>;
    const batch = result?.[kind];
    if (Array.isArray(batch)) items.push(...(batch as T[]));
    cursor = typeof result?.nextCursor === "string" ? result.nextCursor : undefined;
    if (!cursor) break;
  }
  return items;
}

/**
 * Yields long enough for pending stdout/stderr `data` events to be delivered.
 * Bounded and paid once per run — the live accessors on `RuleContext` do the
 * real work; this just closes the window on the very last request.
 */
function drainPipes(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
