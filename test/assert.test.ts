import { describe, expect, it } from "vitest";
import { checkExpectations, resolvePath } from "../src/behavior/assert.js";

const result = {
  content: [
    { type: "text", text: "hello world" },
    { type: "image", data: "..." },
  ],
  structured: { count: 3, tags: ["a", "b"] },
};

describe("resolvePath", () => {
  it("indexes into arrays with numeric segments", () => {
    expect(resolvePath(result, "content.0.text")).toBe("hello world");
    expect(resolvePath(result, "structured.tags.1")).toBe("b");
  });

  it("returns a missing sentinel rather than undefined for absent paths", () => {
    // `undefined` would be ambiguous with a property explicitly set to undefined.
    expect(resolvePath(result, "content.9.text")).not.toBeUndefined();
    expect(checkExpectations(result, { "content.9.text": { exists: false } })).toEqual([]);
  });
});

describe("checkExpectations", () => {
  it("treats a bare scalar as deep equality", () => {
    expect(checkExpectations(result, { "content.0.text": "hello world" })).toEqual([]);
    expect(checkExpectations(result, { "content.0.text": "nope" })).toHaveLength(1);
  });

  it("supports contains, matches and length", () => {
    expect(
      checkExpectations(result, {
        "content.0.text": { contains: "world" },
        "structured.tags": { length: 2 },
        "content.1.type": { matches: "^ima" },
      }),
    ).toEqual([]);
  });

  it("compares numbers with gt and lt", () => {
    expect(checkExpectations(result, { "structured.count": { gt: 2, lt: 4 } })).toEqual([]);
    expect(checkExpectations(result, { "structured.count": { gt: 5 } })).toHaveLength(1);
  });

  it("checks types", () => {
    expect(checkExpectations(result, { "structured.tags": { type: "array" } })).toEqual([]);
    expect(checkExpectations(result, { structured: { type: "array" } })).toHaveLength(1);
  });

  it("applies the spec default for isError so the obvious assertion works", () => {
    // Servers omit isError on success; `isError: false` still has to pass.
    expect(checkExpectations({ content: [] }, { isError: false })).toEqual([]);
    expect(checkExpectations({ content: [], isError: true }, { isError: false })).toHaveLength(1);
  });

  it("reports the path, expected and actual on failure", () => {
    const [failure] = checkExpectations(result, { "content.0.text": "bye" });
    expect(failure).toMatchObject({ path: "content.0.text" });
    expect(failure!.expected).toContain("bye");
    expect(failure!.actual).toContain("hello world");
  });

  it("rejects an invalid regex instead of throwing", () => {
    const failures = checkExpectations(result, { "content.0.text": { matches: "([" } });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.expected).toContain("valid regex");
  });
});
