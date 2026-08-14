import type { RunResult } from "../types.js";

/**
 * JUnit XML, because that is what GitHub Actions, GitLab and Jenkins all know
 * how to render inline. Conformance rules and behavior tests become two
 * testsuites so a failure lands on the right line in the CI summary.
 */
export function formatJUnit(result: RunResult): string {
  const conformanceCases = buildConformanceCases(result);
  const behaviorCases = result.behavior.map((t) => ({
    name: t.name,
    time: t.durationMs / 1000,
    failure: t.passed
      ? null
      : t.error ??
        (t.failures ?? [])
          .map((f) => `${f.path}: expected ${f.expected}, received ${f.actual}`)
          .join("\n"),
  }));

  const suites = [
    renderSuite("conformance", conformanceCases),
    renderSuite("behavior", behaviorCases),
  ];

  const failures = [...conformanceCases, ...behaviorCases].filter((c) => c.failure).length;
  const tests = conformanceCases.length + behaviorCases.length;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="mcp-spec" tests="${tests}" failures="${failures}">`,
    ...suites,
    "</testsuites>",
    "",
  ].join("\n");
}

interface Case {
  name: string;
  time: number;
  failure: string | null;
}

function buildConformanceCases(result: RunResult): Case[] {
  // One case per rule that produced findings, plus a single passing case per
  // clean rule would be noisy — instead we emit a case per fired rule and one
  // aggregate case for everything that passed.
  const byRule = new Map<string, string[]>();
  for (const f of result.conformance.findings) {
    if (f.severity !== "error") continue;
    const lines = byRule.get(f.rule) ?? [];
    lines.push(f.target ? `${f.target}: ${f.message}` : f.message);
    byRule.set(f.rule, lines);
  }

  const cases: Case[] = [...byRule.entries()].map(([rule, lines]) => ({
    name: rule,
    time: 0,
    failure: lines.join("\n"),
  }));

  const clean = result.conformance.passed;
  if (clean > 0) {
    cases.push({ name: `${clean} rules passed`, time: 0, failure: null });
  }
  return cases;
}

function renderSuite(name: string, cases: Case[]): string {
  const failures = cases.filter((c) => c.failure).length;
  const body = cases
    .map((c) => {
      const open = `    <testcase classname="mcp-spec.${name}" name="${esc(c.name)}" time="${c.time.toFixed(3)}"`;
      if (!c.failure) return `${open} />`;
      return `${open}>\n      <failure message="${esc(firstLine(c.failure))}">${esc(c.failure)}</failure>\n    </testcase>`;
    })
    .join("\n");
  return `  <testsuite name="${esc(name)}" tests="${cases.length}" failures="${failures}">\n${body}\n  </testsuite>`;
}

function firstLine(s: string): string {
  return s.split("\n")[0] ?? s;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
