import { describe, expect, it } from "vitest";
import { ConfigError, validateConfig } from "../src/config.js";
import { allRules, resolveSeverity } from "../src/rules/index.js";

describe("validateConfig", () => {
  it("accepts a minimal stdio config", () => {
    const config = validateConfig({ server: { command: "node", args: ["server.js"] } });
    expect(config.server).toMatchObject({ command: "node", args: ["server.js"] });
    expect(config.conformance).toBe("recommended");
  });

  it("accepts an http config", () => {
    const config = validateConfig({ server: { url: "https://example.com/mcp" } });
    expect(config.server).toMatchObject({ url: "https://example.com/mcp" });
  });

  it("rejects a server with both transports", () => {
    expect(() => validateConfig({ server: { command: "node", url: "https://x/mcp" } })).toThrow(
      ConfigError,
    );
  });

  it("rejects a test that selects nothing", () => {
    expect(() => validateConfig({ server: { command: "node" }, tests: [{ input: {} }] })).toThrow(
      /needs one of/,
    );
  });

  it("rejects a test that selects two primitives", () => {
    expect(() =>
      validateConfig({ server: { command: "node" }, tests: [{ tool: "a", prompt: "b" }] }),
    ).toThrow(/pick one/);
  });

  it("rejects an unknown severity", () => {
    expect(() =>
      validateConfig({ server: { command: "node" }, rules: { "tools/name-format": "loud" } }),
    ).toThrow(/error, warn or off/);
  });
});

describe("resolveSeverity", () => {
  const rule = allRules.find((r) => r.defaultSeverity === "warn")!;

  it("uses the rule default under the recommended profile", () => {
    expect(resolveSeverity(rule, "recommended")).toBe("warn");
  });

  it("promotes warnings to errors under strict", () => {
    expect(resolveSeverity(rule, "strict")).toBe("error");
  });

  it("lets an explicit override win, even under off", () => {
    expect(resolveSeverity(rule, "off", { [rule.name]: "error" })).toBe("error");
    expect(resolveSeverity(rule, "strict", { [rule.name]: "off" })).toBe("off");
  });

  it("supports category wildcards", () => {
    expect(resolveSeverity(rule, "strict", { [`${rule.category}/*`]: "off" })).toBe("off");
  });
});

describe("rule catalog", () => {
  it("has unique rule names", () => {
    const names = allRules.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names every rule `category/slug`", () => {
    for (const rule of allRules) {
      expect(rule.name.startsWith(`${rule.category}/`)).toBe(true);
    }
  });

  it("gives every rule a description", () => {
    for (const rule of allRules) {
      expect(rule.description.length).toBeGreaterThan(10);
    }
  });
});
