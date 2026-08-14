import type { Finding, Rule } from "../types.js";
import { checkSchema, estimateTokens, finding, isRecord, walkSchema } from "./util.js";

/**
 * Accepted by every major client and by OpenAI function calling. Servers that
 * stray from it (dots, slashes, spaces) get silently dropped or renamed.
 */
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Beyond this, a description is eating context that the caller pays for. */
const LONG_DESCRIPTION = 1024;

/**
 * Keywords that are legal JSON Schema but not portable across MCP clients —
 * notably rejected by OpenAI structured-output strict mode.
 */
const RISKY_KEYWORDS = ["$ref", "allOf", "oneOf", "anyOf", "not", "if", "then", "else"];

export const toolRules: Rule[] = [
  {
    name: "tools/name-format",
    category: "tools",
    description: "tool names match ^[a-zA-Z0-9_-]{1,64}$",
    defaultSeverity: "error",
    requires: "tools",
    run(ctx) {
      const findings = ctx.tools
        .filter((t) => !NAME_PATTERN.test(t.name))
        .map((t) =>
          finding("tools/name-format", `tool name \`${t.name}\` is not portable`, {
            target: t.name,
            hint: "use letters, digits, underscore and hyphen only, max 64 chars",
          }),
        );
      return { findings };
    },
  },

  {
    name: "tools/name-unique",
    category: "tools",
    description: "no two tools share a name",
    defaultSeverity: "error",
    requires: "tools",
    run(ctx) {
      const seen = new Map<string, number>();
      for (const t of ctx.tools) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
      const findings = [...seen.entries()]
        .filter(([, n]) => n > 1)
        .map(([name, n]) =>
          finding("tools/name-unique", `tool \`${name}\` is declared ${n} times`, {
            target: name,
            hint: "clients keep whichever they saw last, so one implementation silently wins",
          }),
        );
      return { findings };
    },
  },

  {
    name: "tools/description-present",
    category: "tools",
    description: "every tool has a non-empty description",
    defaultSeverity: "error",
    requires: "tools",
    run(ctx) {
      const findings = ctx.tools
        .filter((t) => !t.description?.trim())
        .map((t) =>
          finding("tools/description-present", `tool \`${t.name}\` has no description`, {
            target: t.name,
            hint: "the description is the only thing telling the model when to pick this tool",
          }),
        );
      return { findings };
    },
  },

  {
    name: "tools/description-length",
    category: "tools",
    description: "descriptions stay under 1024 characters",
    defaultSeverity: "warn",
    requires: "tools",
    run(ctx) {
      const findings = ctx.tools
        .filter((t) => (t.description?.length ?? 0) > LONG_DESCRIPTION)
        .map((t) =>
          finding(
            "tools/description-length",
            `\`${t.name}\` description is ${t.description!.length} characters`,
            {
              target: t.name,
              hint: `every tool description is resent on every turn — keep it under ${LONG_DESCRIPTION}`,
            },
          ),
        );
      return { findings };
    },
  },

  {
    name: "tools/input-schema-valid",
    category: "tools",
    description: "inputSchema is a compilable JSON Schema object",
    defaultSeverity: "error",
    requires: "tools",
    run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.tools) {
        if (t.inputSchema === undefined) {
          findings.push(
            finding("tools/input-schema-valid", `\`${t.name}\` has no inputSchema`, {
              target: t.name,
              hint: "declare `{ type: \"object\", properties: {} }` even for tools that take nothing",
            }),
          );
          continue;
        }
        const result = checkSchema(t.inputSchema);
        if (!result.valid) {
          findings.push(
            finding("tools/input-schema-valid", `\`${t.name}\` inputSchema does not compile: ${result.error}`, {
              target: t.name,
              path: "inputSchema",
            }),
          );
          continue;
        }
        if (isRecord(t.inputSchema) && t.inputSchema.type !== "object") {
          findings.push(
            finding(
              "tools/input-schema-valid",
              `\`${t.name}\` inputSchema has type \`${String(t.inputSchema.type)}\`, expected \`object\``,
              {
                target: t.name,
                path: "inputSchema.type",
                hint: "tool arguments are always a named-argument object",
              },
            ),
          );
        }
      }
      return { findings };
    },
  },

  {
    name: "tools/no-required-false",
    category: "tools",
    description: "`required: false` is not used as a property-level flag",
    defaultSeverity: "error",
    requires: "tools",
    run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.tools) {
        walkSchema(t.inputSchema, (node, path) => {
          if (typeof node.required === "boolean") {
            findings.push(
              finding(
                "tools/no-required-false",
                `\`${t.name}\` uses \`required: ${node.required}\` as a boolean at ${path}`,
                {
                  target: t.name,
                  path: `${path}.required`,
                  hint: "in JSON Schema, `required` is an array of property names on the parent object",
                },
              ),
            );
          }
        });
      }
      return { findings };
    },
  },

  {
    name: "tools/required-properties-exist",
    category: "tools",
    description: "every name listed in `required` is actually defined in `properties`",
    defaultSeverity: "error",
    requires: "tools",
    run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.tools) {
        walkSchema(t.inputSchema, (node, path) => {
          if (!Array.isArray(node.required)) return;
          const props = isRecord(node.properties) ? node.properties : {};
          for (const name of node.required) {
            if (typeof name === "string" && !(name in props)) {
              findings.push(
                finding(
                  "tools/required-properties-exist",
                  `\`${t.name}\` requires \`${name}\`, which is not defined in properties`,
                  {
                    target: t.name,
                    path: `${path}.required`,
                    hint: "the model can never satisfy this schema, so the tool becomes uncallable",
                  },
                ),
              );
            }
          }
        });
      }
      return { findings };
    },
  },

  {
    name: "tools/param-description",
    category: "tools",
    description: "every top-level parameter carries a description",
    defaultSeverity: "warn",
    requires: "tools",
    run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.tools) {
        const schema = t.inputSchema;
        if (!isRecord(schema) || !isRecord(schema.properties)) continue;
        for (const [name, prop] of Object.entries(schema.properties)) {
          if (!isRecord(prop) || !String(prop.description ?? "").trim()) {
            findings.push(
              finding("tools/param-description", `\`${t.name}.${name}\` has no description`, {
                target: t.name,
                path: `inputSchema.properties.${name}`,
                hint: "undescribed parameters are the most common cause of malformed tool calls",
              }),
            );
          }
        }
      }
      return { findings };
    },
  },

  {
    name: "tools/portable-schema",
    category: "tools",
    description: "inputSchema avoids keywords that some clients reject",
    defaultSeverity: "warn",
    requires: "tools",
    run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.tools) {
        const hit = new Set<string>();
        walkSchema(t.inputSchema, (node) => {
          for (const kw of RISKY_KEYWORDS) if (kw in node) hit.add(kw);
        });
        if (hit.size > 0) {
          findings.push(
            finding(
              "tools/portable-schema",
              `\`${t.name}\` uses ${[...hit].map((k) => `\`${k}\``).join(", ")}`,
              {
                target: t.name,
                path: "inputSchema",
                hint: "these are valid JSON Schema but are rejected or flattened by several clients — inline them",
              },
            ),
          );
        }
      }
      return { findings };
    },
  },

  {
    name: "tools/annotations-present",
    category: "tools",
    description: "tools declare readOnlyHint / destructiveHint",
    defaultSeverity: "warn",
    requires: "tools",
    run(ctx) {
      const findings = ctx.tools
        .filter((t) => {
          const a = t.annotations;
          return !isRecord(a) || (a.readOnlyHint === undefined && a.destructiveHint === undefined);
        })
        .map((t) =>
          finding("tools/annotations-present", `\`${t.name}\` declares no readOnlyHint or destructiveHint`, {
            target: t.name,
            path: "annotations",
            hint: "without hints, clients must prompt for approval on every call, including harmless reads",
          }),
        );
      return { findings };
    },
  },

  {
    name: "tools/output-schema-valid",
    category: "tools",
    description: "outputSchema, when present, compiles",
    defaultSeverity: "error",
    requires: "tools",
    run(ctx) {
      const findings: Finding[] = [];
      for (const t of ctx.tools) {
        if (t.outputSchema === undefined) continue;
        const result = checkSchema(t.outputSchema);
        if (!result.valid) {
          findings.push(
            finding("tools/output-schema-valid", `\`${t.name}\` outputSchema does not compile: ${result.error}`, {
              target: t.name,
              path: "outputSchema",
            }),
          );
        }
      }
      return { findings };
    },
  },

  {
    name: "tools/context-cost",
    category: "tools",
    description: "the tool list fits inside the configured context budget",
    defaultSeverity: "warn",
    requires: "tools",
    run(ctx) {
      const perTool = ctx.tools.map((t) => ({ name: t.name, tokens: estimateTokens(t) }));
      const total = perTool.reduce((sum, t) => sum + t.tokens, 0);
      const stats = {
        toolCount: ctx.tools.length,
        estimatedTokens: total,
      };

      const budget = ctx.contextBudget;
      if (budget === undefined || total <= budget) return { findings: [], stats };

      const worst = [...perTool].sort((a, b) => b.tokens - a.tokens).slice(0, 3);
      return {
        stats,
        findings: [
          finding(
            "tools/context-cost",
            `tool definitions cost about ${total} tokens, over the budget of ${budget}`,
            {
              hint: `largest: ${worst.map((t) => `${t.name} (~${t.tokens})`).join(", ")}`,
            },
          ),
        ],
      };
    },
  },
];
