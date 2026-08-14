#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigError, findConfig, loadConfig, validateConfig } from "./config.js";
import { ConnectError } from "./connect.js";
import { run } from "./run.js";
import { allRules } from "./rules/index.js";
import { formatPretty } from "./report/pretty.js";
import { formatJUnit } from "./report/junit.js";
import type { Config, Profile } from "./types.js";

const VERSION = "0.1.0";

const HELP = `
  mcp-spec ${VERSION}

  Conformance and behavior testing for MCP servers.

  Usage
    mcp-spec [options]                    run against the nearest mcp.test.yaml
    mcp-spec -- <command> [args...]       run against an ad-hoc stdio server
    mcp-spec --url <url>                  run against an ad-hoc HTTP server
    mcp-spec init                         write a starter mcp.test.yaml
    mcp-spec rules                        print the rule catalog

  Options
    -c, --config <path>     config file to use
    -r, --reporter <name>   pretty | json | junit          (default: pretty)
    -o, --out <path>        write the report to a file instead of stdout
        --conformance <p>   strict | recommended | off     (overrides the config)
        --budget <tokens>   fail when tool definitions exceed this token estimate
        --header <k:v>      extra HTTP header, repeatable  (with --url)
        --timeout <ms>      per-request timeout            (default: 30000)
        --no-tests          run conformance only, skip behavior tests
    -h, --help              show this
    -v, --version           print the version

  Exit codes
    0  clean            1  errors or failing tests            2  could not run
`;

const STARTER = `# mcp-spec configuration — https://github.com/dbc1234/mcp-spec
server:
  command: node
  args: [dist/index.js]

# strict promotes every warning to an error; off disables the catalog
conformance: recommended

# Fail the build if tool definitions grow past this token estimate.
# contextBudget: 4000

# Silence a rule you have deliberately opted out of:
# rules:
#   tools/annotations-present: off

tests:
  - name: server answers a basic call
    tool: TOOL_NAME
    input: {}
    expect:
      isError: false
      content.0.type: text
`;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.flags.help) return print(HELP), 0;
  if (args.flags.version) return print(VERSION), 0;

  const command = args.positional[0];
  if (command === "rules") return printRules(), 0;
  if (command === "init") return await initConfig(args.options.config);

  let config: Config;
  let cwd = process.cwd();

  const adHoc = buildAdHocTarget(args);
  if (adHoc) {
    config = validateConfig({ server: adHoc }, "command line");
  } else {
    const path = args.options.config ? resolve(args.options.config) : findConfig();
    if (!path) {
      fail(
        "no config found.\n" +
          "  Create one with `mcp-spec init`, or point at a server directly:\n" +
          "    mcp-spec -- node dist/index.js\n" +
          "    mcp-spec --url https://example.com/mcp",
      );
      return 2;
    }
    const loaded = await loadConfig(path);
    config = loaded.config;
    cwd = loaded.dir;
  }

  if (args.options.conformance) config.conformance = args.options.conformance as Profile;
  if (args.options.budget !== undefined) config.contextBudget = args.options.budget;
  if (args.options.timeout !== undefined) config.timeout = args.options.timeout;
  if (args.flags.noTests) config.tests = [];
  if (!("url" in config.server) && !config.server.cwd) config.server.cwd = cwd;

  const result = await run(config);

  const reporter = args.options.reporter ?? "pretty";
  const output =
    reporter === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : reporter === "junit"
        ? formatJUnit(result)
        : formatPretty(result);

  if (args.options.out) {
    await writeFile(args.options.out, output, "utf8");
    print(`report written to ${args.options.out}`);
  } else {
    print(output);
  }

  return result.ok ? 0 : 1;
}

function buildAdHocTarget(args: ParsedArgs): Record<string, unknown> | null {
  if (args.options.url) {
    const headers: Record<string, string> = {};
    for (const raw of args.options.headers) {
      const idx = raw.indexOf(":");
      if (idx === -1) throw new ConfigError(`--header expects \`Name: value\`, got ${JSON.stringify(raw)}`);
      headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
    }
    return { url: args.options.url, headers: Object.keys(headers).length ? headers : undefined };
  }
  if (args.rest.length > 0) {
    return { command: args.rest[0], args: args.rest.slice(1) };
  }
  return null;
}

async function initConfig(target?: string): Promise<number> {
  const path = resolve(target ?? "mcp.test.yaml");
  if (existsSync(path)) {
    fail(`${path} already exists`);
    return 2;
  }
  await writeFile(path, STARTER, "utf8");
  print(`created ${path}\n\nEdit \`server\` and the example test, then run \`npx mcp-spec\`.`);
  return 0;
}

function printRules(): void {
  const width = Math.max(...allRules.map((r) => r.name.length));
  let category = "";
  const lines: string[] = [""];
  for (const rule of allRules) {
    if (rule.category !== category) {
      category = rule.category;
      lines.push(`  ${category}`);
    }
    lines.push(`    ${rule.name.padEnd(width)}  ${rule.defaultSeverity.padEnd(5)}  ${rule.description}`);
  }
  lines.push("");
  lines.push("  Severities shown are the `recommended` profile; `strict` promotes all to error.");
  lines.push("");
  print(lines.join("\n"));
}

/* ------------------------------------------------------------------ */
/* Argument parsing                                                    */
/* ------------------------------------------------------------------ */

interface ParsedArgs {
  positional: string[];
  /** Everything after `--`, treated as a server command line. */
  rest: string[];
  flags: { help: boolean; version: boolean; noTests: boolean };
  options: {
    config?: string;
    reporter?: string;
    out?: string;
    conformance?: string;
    url?: string;
    budget?: number;
    timeout?: number;
    headers: string[];
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    positional: [],
    rest: [],
    flags: { help: false, version: false, noTests: false },
    options: { headers: [] },
  };

  const separator = argv.indexOf("--");
  const head = separator === -1 ? argv : argv.slice(0, separator);
  if (separator !== -1) parsed.rest = argv.slice(separator + 1);

  for (let i = 0; i < head.length; i++) {
    const arg = head[i]!;
    const next = () => {
      const value = head[++i];
      if (value === undefined) throw new ConfigError(`${arg} expects a value`);
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        parsed.flags.help = true;
        break;
      case "-v":
      case "--version":
        parsed.flags.version = true;
        break;
      case "--no-tests":
        parsed.flags.noTests = true;
        break;
      case "-c":
      case "--config":
        parsed.options.config = next();
        break;
      case "-r":
      case "--reporter":
        parsed.options.reporter = requireOneOf(next(), ["pretty", "json", "junit"], "--reporter");
        break;
      case "-o":
      case "--out":
        parsed.options.out = next();
        break;
      case "--conformance":
        parsed.options.conformance = requireOneOf(next(), ["strict", "recommended", "off"], "--conformance");
        break;
      case "--url":
        parsed.options.url = next();
        break;
      case "--header":
        parsed.options.headers.push(next());
        break;
      case "--budget":
        parsed.options.budget = requireNumber(next(), "--budget");
        break;
      case "--timeout":
        parsed.options.timeout = requireNumber(next(), "--timeout");
        break;
      default:
        if (arg.startsWith("-")) throw new ConfigError(`unknown option ${arg} (try --help)`);
        parsed.positional.push(arg);
    }
  }
  return parsed;
}

function requireOneOf(value: string, allowed: string[], flag: string): string {
  if (!allowed.includes(value)) {
    throw new ConfigError(`${flag} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ConfigError(`${flag} expects a number, got ${JSON.stringify(value)}`);
  return n;
}

function print(s: string): void {
  process.stdout.write(`${s}\n`);
}

function fail(s: string): void {
  process.stderr.write(`mcp-spec: ${s}\n`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof ConfigError || err instanceof ConnectError) {
      fail(err.message);
    } else {
      fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
    process.exitCode = 2;
  });
