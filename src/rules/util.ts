import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Finding, Severity } from "../types.js";

/**
 * Both packages ship CJS with an extra `.default`, so the shape we get back
 * depends on whether the consumer bundles or runs this natively.
 */
function interop<T>(mod: T): T {
  return (mod as { default?: T }).default ?? mod;
}

/** Shared across rules — compiling a fresh Ajv per tool is measurably slower. */
const ajv = new (interop(Ajv2020))({
  strict: false,
  allErrors: true,
  validateSchema: true,
});
interop(addFormats)(ajv);

export interface SchemaCheck {
  valid: boolean;
  error?: string;
}

/** Is this a schema Ajv can compile at all? */
export function checkSchema(schema: unknown): SchemaCheck {
  if (typeof schema !== "object" || schema === null) {
    return { valid: false, error: "not an object" };
  }
  try {
    ajv.compile(schema as object);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function finding(
  rule: string,
  message: string,
  extra: Partial<Omit<Finding, "rule" | "message" | "severity">> = {},
): Finding {
  // Severity is a placeholder here; the runner rewrites it from the profile
  // and any user override before the finding reaches a reporter.
  return { rule, message, severity: "error", ...extra };
}

/**
 * Rough token count for budgeting only. Deliberately a heuristic — a real BPE
 * pass would mean shipping a tokenizer, and every model tokenizes differently.
 * Overestimates slightly on punctuation-heavy JSON, which is the safe direction
 * for a budget check.
 */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (!text) return 0;
  const words = text.split(/[\s"{}[\],:]+/).filter(Boolean).length;
  return Math.max(Math.ceil(text.length / 4), words);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Walks every schema node depth-first, yielding a dotted path so findings can
 * point at the exact offending keyword.
 */
export function walkSchema(
  schema: unknown,
  visit: (node: Record<string, unknown>, path: string) => void,
  path = "inputSchema",
  seen = new Set<unknown>(),
): void {
  if (!isRecord(schema) || seen.has(schema)) return;
  seen.add(schema);
  visit(schema, path);

  const props = schema.properties;
  if (isRecord(props)) {
    for (const [key, child] of Object.entries(props)) {
      walkSchema(child, visit, `${path}.properties.${key}`, seen);
    }
  }
  if (schema.items !== undefined) walkSchema(schema.items, visit, `${path}.items`, seen);
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const branch = schema[key];
    if (Array.isArray(branch)) {
      branch.forEach((child, i) => walkSchema(child, visit, `${path}.${key}.${i}`, seen));
    }
  }
  if (schema.not !== undefined) walkSchema(schema.not, visit, `${path}.not`, seen);
  const defs = schema.$defs ?? schema.definitions;
  if (isRecord(defs)) {
    for (const [key, child] of Object.entries(defs)) {
      walkSchema(child, visit, `${path}.$defs.${key}`, seen);
    }
  }
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function severityRank(s: Severity): number {
  return s === "error" ? 2 : s === "warn" ? 1 : 0;
}
