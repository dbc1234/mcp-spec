import type { Matcher } from "../types.js";

export interface AssertionFailure {
  path: string;
  expected: string;
  actual: string;
}

const MISSING = Symbol("missing");

/**
 * Fields the spec defines a default for. Servers routinely omit them on the
 * happy path, so an absent value has to read as the default rather than as
 * missing — otherwise the obvious `isError: false` assertion never passes.
 */
const SPEC_DEFAULTS: Record<string, unknown> = {
  isError: false,
};

/**
 * Resolves a dotted path against a result object. Numeric segments index into
 * arrays, so `content.0.text` reads the first content block's text.
 */
export function resolvePath(root: unknown, path: string): unknown | typeof MISSING {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return MISSING;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return MISSING;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return MISSING;
    const record = current as Record<string, unknown>;
    if (!(segment in record)) return MISSING;
    current = record[segment];
  }
  return current;
}

export function checkExpectations(
  result: unknown,
  expectations: Record<string, Matcher>,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  for (const [path, matcher] of Object.entries(expectations)) {
    let actual = resolvePath(result, path);
    if (actual === MISSING && path in SPEC_DEFAULTS) actual = SPEC_DEFAULTS[path];
    const failure = checkOne(path, actual, matcher);
    if (failure) failures.push(failure);
  }
  return failures;
}

function checkOne(path: string, actual: unknown, matcher: Matcher): AssertionFailure | null {
  const present = actual !== MISSING;
  const shown = present ? render(actual) : "<missing>";

  if (matcher === null || typeof matcher !== "object") {
    return deepEqual(actual, matcher)
      ? null
      : { path, expected: render(matcher), actual: shown };
  }

  // `exists` is checked first so `{ exists: false }` can assert absence
  // without the other operators tripping over a missing value.
  if (matcher.exists !== undefined) {
    if (matcher.exists !== present) {
      return { path, expected: matcher.exists ? "to exist" : "to be absent", actual: shown };
    }
    if (!matcher.exists) return null;
  }

  if (!present) return { path, expected: describe(matcher), actual: "<missing>" };

  if (matcher.equals !== undefined && !deepEqual(actual, matcher.equals)) {
    return { path, expected: render(matcher.equals), actual: shown };
  }
  if (matcher.type !== undefined && typeName(actual) !== matcher.type) {
    return { path, expected: `type ${matcher.type}`, actual: `type ${typeName(actual)}` };
  }
  if (matcher.contains !== undefined) {
    const haystack = typeof actual === "string" ? actual : JSON.stringify(actual);
    if (!haystack.includes(matcher.contains)) {
      return { path, expected: `to contain ${JSON.stringify(matcher.contains)}`, actual: shown };
    }
  }
  if (matcher.matches !== undefined) {
    const haystack = typeof actual === "string" ? actual : JSON.stringify(actual);
    let re: RegExp;
    try {
      re = new RegExp(matcher.matches);
    } catch {
      return { path, expected: `a valid regex, got ${JSON.stringify(matcher.matches)}`, actual: shown };
    }
    if (!re.test(haystack)) {
      return { path, expected: `to match /${matcher.matches}/`, actual: shown };
    }
  }
  if (matcher.length !== undefined) {
    const len = lengthOf(actual);
    if (len !== matcher.length) {
      return { path, expected: `length ${matcher.length}`, actual: len === null ? shown : `length ${len}` };
    }
  }
  if (matcher.gt !== undefined) {
    if (typeof actual !== "number" || !(actual > matcher.gt)) {
      return { path, expected: `> ${matcher.gt}`, actual: shown };
    }
  }
  if (matcher.lt !== undefined) {
    if (typeof actual !== "number" || !(actual < matcher.lt)) {
      return { path, expected: `< ${matcher.lt}`, actual: shown };
    }
  }
  return null;
}

function describe(matcher: Exclude<Matcher, string | number | boolean | null>): string {
  const parts = Object.entries(matcher)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} ${render(v)}`);
  return parts.join(" and ") || "anything";
}

function lengthOf(v: unknown): number | null {
  if (typeof v === "string" || Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return null;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function render(v: unknown): string {
  if (v === MISSING) return "<missing>";
  if (typeof v === "string") return JSON.stringify(v);
  const json = JSON.stringify(v);
  if (json === undefined) return String(v);
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === MISSING || b === MISSING) return false;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
