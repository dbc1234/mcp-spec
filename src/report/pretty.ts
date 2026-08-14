import type { Finding, RunResult } from "../types.js";

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== "0" &&
  (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined);

const c = {
  dim: paint("[2m"),
  bold: paint("[1m"),
  red: paint("[31m"),
  yellow: paint("[33m"),
  green: paint("[32m"),
  cyan: paint("[36m"),
};

function paint(code: string) {
  return (s: string) => (useColor ? `${code}${s}[0m` : s);
}

export function formatPretty(result: RunResult): string {
  const out: string[] = [];
  const server = result.serverInfo?.name ?? "unknown server";
  const version = result.serverInfo?.version ? ` v${result.serverInfo.version}` : "";

  out.push("");
  out.push(`  ${c.bold(server + version)} ${c.dim(`— ${result.target}`)}`);
  out.push("");

  const { evaluated, passed, findings, profile } = result.conformance;
  if (profile === "off") {
    out.push(`  ${c.dim("Conformance")}  ${c.dim("skipped (conformance: off)")}`);
  } else {
    const label = `${passed}/${evaluated}`;
    const mark = passed === evaluated ? c.green("✓") : c.red("✖");
    out.push(`  ${c.bold("Conformance")}  ${label} rules passed  ${mark}  ${c.dim(`[${profile}]`)}`);
    for (const group of groupByRule(findings)) {
      out.push("");
      out.push(`    ${badge(group[0]!.severity)} ${c.bold(group[0]!.rule)}`);
      for (const f of group) {
        out.push(`      ${f.message}`);
        if (f.path) out.push(`      ${c.dim(f.path)}`);
        if (f.hint) out.push(`      ${c.dim("→ " + f.hint)}`);
      }
    }
  }

  if (result.behavior.length > 0) {
    out.push("");
    const ok = result.behavior.filter((t) => t.passed).length;
    const mark = ok === result.behavior.length ? c.green("✓") : c.red("✖");
    out.push(`  ${c.bold("Behavior")}     ${ok}/${result.behavior.length} tests passed  ${mark}`);
    for (const t of result.behavior) {
      if (t.passed) {
        out.push(`    ${c.green("✓")} ${t.name} ${c.dim(`${t.durationMs}ms`)}`);
        continue;
      }
      out.push(`    ${c.red("✖")} ${t.name} ${c.dim(`${t.durationMs}ms`)}`);
      if (t.error) out.push(`        ${c.red(t.error)}`);
      for (const f of t.failures ?? []) {
        out.push(`        ${c.cyan(f.path)}`);
        out.push(`          expected ${f.expected}`);
        out.push(`          received ${f.actual}`);
      }
    }
  }

  out.push("");
  out.push(`  ${c.dim(statsLine(result))}`);
  out.push("");

  const { errors, warnings, failedTests } = result.counts;
  const parts: string[] = [];
  if (errors) parts.push(c.red(`${errors} error${errors === 1 ? "" : "s"}`));
  if (warnings) parts.push(c.yellow(`${warnings} warning${warnings === 1 ? "" : "s"}`));
  if (failedTests) parts.push(c.red(`${failedTests} failing test${failedTests === 1 ? "" : "s"}`));

  out.push(parts.length === 0 ? `  ${c.green("clean")}` : `  ${parts.join(", ")}`);
  out.push("");
  return out.join("\n");
}

function statsLine(result: RunResult): string {
  const bits = [`startup ${result.startupMs}ms`];
  if (result.stats.toolCount !== undefined) bits.push(`${result.stats.toolCount} tools`);
  if (result.stats.estimatedTokens !== undefined) {
    bits.push(`~${result.stats.estimatedTokens} tokens of tool definitions`);
  }
  return bits.join("  ·  ");
}

function badge(severity: Finding["severity"]): string {
  return severity === "error" ? c.red("✖") : c.yellow("⚠");
}

/** Keeps findings from the same rule together so the output reads as a checklist. */
function groupByRule(findings: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const existing = groups.get(f.rule);
    if (existing) existing.push(f);
    else groups.set(f.rule, [f]);
  }
  // Errors first, then by rule name, so the thing that fails the build is on top.
  return [...groups.values()].sort((a, b) => {
    const rank = (g: Finding[]) => (g[0]!.severity === "error" ? 0 : 1);
    return rank(a) - rank(b) || a[0]!.rule.localeCompare(b[0]!.rule);
  });
}
