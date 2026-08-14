import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config, Profile, Severity } from "./types.js";

const CANDIDATES = [
  "mcp.test.yaml",
  "mcp.test.yml",
  "mcp.test.json",
  ".mcp-spec.yaml",
  ".mcp-spec.yml",
];

export class ConfigError extends Error {}

/** Walk up from `from` looking for a config file. Returns null if none exists. */
export function findConfig(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    for (const name of CANDIDATES) {
      const p = resolve(dir, name);
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function loadConfig(path: string): Promise<{ config: Config; dir: string }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new ConfigError(`cannot read config file: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  } catch (err) {
    throw new ConfigError(`${path} is not valid ${path.endsWith(".json") ? "JSON" : "YAML"}: ${msg(err)}`);
  }

  return { config: validateConfig(parsed, path), dir: dirname(resolve(path)) };
}

/**
 * Hand-rolled rather than schema-driven: the config surface is small, and the
 * errors we can produce here name the exact key the user got wrong.
 */
export function validateConfig(input: unknown, source = "config"): Config {
  if (!isRecord(input)) throw new ConfigError(`${source}: top level must be a mapping`);

  const server = input.server;
  if (!isRecord(server)) {
    throw new ConfigError(`${source}: missing \`server\` — set \`command\` (stdio) or \`url\` (http)`);
  }
  const hasCommand = typeof server.command === "string";
  const hasUrl = typeof server.url === "string";
  if (!hasCommand && !hasUrl) {
    throw new ConfigError(`${source}: \`server\` needs either \`command\` (stdio) or \`url\` (http)`);
  }
  if (hasCommand && hasUrl) {
    throw new ConfigError(`${source}: \`server\` has both \`command\` and \`url\` — pick one transport`);
  }
  if (hasCommand && server.args !== undefined && !isStringArray(server.args)) {
    throw new ConfigError(`${source}: \`server.args\` must be a list of strings`);
  }

  const conformance = input.conformance ?? "recommended";
  if (!isProfile(conformance)) {
    throw new ConfigError(`${source}: \`conformance\` must be strict, recommended or off`);
  }

  const rules: Record<string, Severity> = {};
  if (input.rules !== undefined) {
    if (!isRecord(input.rules)) throw new ConfigError(`${source}: \`rules\` must be a mapping`);
    for (const [name, value] of Object.entries(input.rules)) {
      if (value !== "error" && value !== "warn" && value !== "off") {
        throw new ConfigError(`${source}: rules.${name} must be error, warn or off`);
      }
      rules[name] = value;
    }
  }

  const tests = input.tests ?? [];
  if (!Array.isArray(tests)) throw new ConfigError(`${source}: \`tests\` must be a list`);
  tests.forEach((t, i) => {
    if (!isRecord(t)) throw new ConfigError(`${source}: tests[${i}] must be a mapping`);
    const selectors = ["tool", "resource", "prompt"].filter((k) => t[k] !== undefined);
    if (selectors.length === 0) {
      throw new ConfigError(`${source}: tests[${i}] needs one of \`tool\`, \`resource\` or \`prompt\``);
    }
    if (selectors.length > 1) {
      throw new ConfigError(`${source}: tests[${i}] sets ${selectors.join(" and ")} — pick one`);
    }
  });

  return {
    server: hasUrl
      ? { url: server.url as string, headers: (server.headers as Record<string, string>) ?? undefined }
      : {
          command: server.command as string,
          args: (server.args as string[]) ?? undefined,
          env: (server.env as Record<string, string>) ?? undefined,
          cwd: (server.cwd as string) ?? undefined,
        },
    conformance,
    rules,
    tests: tests as Config["tests"],
    contextBudget: numberOr(input.contextBudget, undefined),
    startupBudget: numberOr(input.startupBudget, 5000),
    timeout: numberOr(input.timeout, 30_000),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isProfile(v: unknown): v is Profile {
  return v === "strict" || v === "recommended" || v === "off";
}
function numberOr<T>(v: unknown, fallback: T): number | T {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
