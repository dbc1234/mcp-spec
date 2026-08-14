import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { validateConfig } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function config(script: string, extra: Record<string, unknown> = {}) {
  return validateConfig({
    server: { command: process.execPath, args: [script], cwd: root },
    ...extra,
  });
}

const DEMO = resolve(root, "examples/demo-server.mjs");
const MESSY = resolve(root, "test/fixtures/messy-server.mjs");

describe("a well-behaved server", () => {
  it("passes the whole catalog", async () => {
    const result = await run(config(DEMO));
    const messages = result.conformance.findings.map((f) => `${f.rule}: ${f.message}`);
    expect(messages).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.conformance.passed).toBe(result.conformance.evaluated);
  }, 30_000);

  it("reports the tools it found", async () => {
    const result = await run(config(DEMO));
    expect(result.stats.toolCount).toBe(2);
    expect(result.stats.estimatedTokens).toBeGreaterThan(0);
    expect(result.serverInfo?.name).toBe("mcp-spec-demo");
  }, 30_000);

  it("runs behavior tests and reports failures with a path", async () => {
    const result = await run(
      config(DEMO, {
        conformance: "off",
        tests: [
          { name: "echo works", tool: "echo", input: { message: "hi" }, expect: { "content.0.text": "hi" } },
          { name: "echo is wrong", tool: "echo", input: { message: "hi" }, expect: { "content.0.text": "bye" } },
        ],
      }),
    );
    expect(result.behavior[0]!.passed).toBe(true);
    expect(result.behavior[1]!.passed).toBe(false);
    expect(result.behavior[1]!.failures?.[0]?.path).toBe("content.0.text");
    expect(result.ok).toBe(false);
  }, 30_000);
});

describe("a broken server", () => {
  /** Every rule the messy fixture is built to trip. */
  const EXPECTED = [
    "hygiene/stdout-jsonrpc-only",
    "hygiene/stderr-quiet",
    "protocol/unknown-tool",
    "protocol/invalid-arguments",
    "resources/readable",
    "resources/uri-valid",
    "resources/name-present",
    "resources/mime-type",
    "tools/description-present",
    "tools/input-schema-valid",
    "tools/name-format",
    "tools/name-unique",
    "tools/no-required-false",
    "tools/required-properties-exist",
    "tools/param-description",
    "tools/portable-schema",
    "tools/annotations-present",
  ];

  it.each(EXPECTED)("fires %s", async (rule) => {
    const result = await run(config(MESSY));
    const fired = new Set(result.conformance.findings.map((f) => f.rule));
    expect([...fired]).toContain(rule);
  }, 30_000);

  it("survives a malformed tools/list instead of crashing", async () => {
    // The SDK client rejects this payload outright; reading the raw response
    // is the only way to lint it, so this is a regression guard on `raw.ts`.
    const result = await run(config(MESSY));
    expect(result.stats.toolCount).toBe(4);
    expect(result.ok).toBe(false);
  }, 30_000);

  it("promotes warnings to errors under the strict profile", async () => {
    const recommended = await run(config(MESSY, { conformance: "recommended" }));
    const strict = await run(config(MESSY, { conformance: "strict" }));
    expect(recommended.counts.warnings).toBeGreaterThan(0);
    expect(strict.counts.warnings).toBe(0);
    expect(strict.counts.errors).toBeGreaterThan(recommended.counts.errors);
  }, 60_000);

  it("silences a rule that is switched off", async () => {
    const result = await run(config(MESSY, { rules: { "tools/name-format": "off" } }));
    const fired = new Set(result.conformance.findings.map((f) => f.rule));
    expect(fired.has("tools/name-format")).toBe(false);
  }, 30_000);

  it("fails the context budget when the tool list is too large", async () => {
    const result = await run(config(MESSY, { contextBudget: 1 }));
    const budget = result.conformance.findings.find((f) => f.rule === "tools/context-cost");
    expect(budget).toBeDefined();
    expect(budget!.message).toContain("over the budget");
  }, 30_000);
});
