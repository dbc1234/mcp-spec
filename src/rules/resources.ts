import type { Finding, Rule } from "../types.js";
import { rawRequest } from "../raw.js";
import { finding } from "./util.js";

/** Reading every resource could be expensive; a sample is enough to catch a broken handler. */
const READ_SAMPLE = 3;

export const resourceRules: Rule[] = [
  {
    name: "resources/uri-valid",
    category: "resources",
    description: "resource URIs parse as absolute URIs",
    defaultSeverity: "error",
    requires: "resources",
    run(ctx) {
      const findings = ctx.resources
        .filter((r) => !isAbsoluteUri(r.uri))
        .map((r) =>
          finding("resources/uri-valid", `resource URI \`${r.uri}\` is not an absolute URI`, {
            target: r.uri,
            hint: "resource URIs need a scheme, e.g. `file://`, `https://` or a custom one",
          }),
        );
      return { findings };
    },
  },

  {
    name: "resources/name-present",
    category: "resources",
    description: "every resource has a human-readable name",
    defaultSeverity: "warn",
    requires: "resources",
    run(ctx) {
      const findings = ctx.resources
        .filter((r) => !r.name?.trim())
        .map((r) =>
          finding("resources/name-present", `resource \`${r.uri}\` has no name`, {
            target: r.uri,
            hint: "clients fall back to showing the raw URI in pickers",
          }),
        );
      return { findings };
    },
  },

  {
    name: "resources/mime-type",
    category: "resources",
    description: "resources declare a mimeType",
    defaultSeverity: "warn",
    requires: "resources",
    run(ctx) {
      const findings = ctx.resources
        .filter((r) => !r.mimeType?.trim())
        .map((r) =>
          finding("resources/mime-type", `resource \`${r.uri}\` declares no mimeType`, {
            target: r.uri,
            hint: "clients use mimeType to decide between rendering, embedding and refusing content",
          }),
        );
      return { findings };
    },
  },

  {
    name: "resources/readable",
    category: "resources",
    description: "listed resources can actually be read",
    defaultSeverity: "error",
    requires: "resources",
    async run(ctx) {
      const findings: Finding[] = [];
      for (const r of ctx.resources.slice(0, READ_SAMPLE)) {
        try {
          const result = await rawRequest(ctx.client, "resources/read", { uri: r.uri }, 10_000);
          const contents = (result as { contents?: unknown[] }).contents;
          if (!Array.isArray(contents) || contents.length === 0) {
            findings.push(
              finding("resources/readable", `reading \`${r.uri}\` returned no contents`, {
                target: r.uri,
                hint: "a listed resource that reads empty looks broken to the model",
              }),
            );
          }
        } catch (err) {
          findings.push(
            finding("resources/readable", `reading \`${r.uri}\` failed: ${message(err)}`, {
              target: r.uri,
              hint: "the resource is advertised in resources/list but cannot be fetched",
            }),
          );
        }
      }
      return { findings };
    },
  },
];

export const promptRules: Rule[] = [
  {
    name: "prompts/name-unique",
    category: "prompts",
    description: "no two prompts share a name",
    defaultSeverity: "error",
    requires: "prompts",
    run(ctx) {
      const seen = new Map<string, number>();
      for (const p of ctx.prompts) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
      const findings = [...seen.entries()]
        .filter(([, n]) => n > 1)
        .map(([name, n]) =>
          finding("prompts/name-unique", `prompt \`${name}\` is declared ${n} times`, { target: name }),
        );
      return { findings };
    },
  },

  {
    name: "prompts/described",
    category: "prompts",
    description: "prompts and their arguments carry descriptions",
    defaultSeverity: "warn",
    requires: "prompts",
    run(ctx) {
      const findings: Finding[] = [];
      for (const p of ctx.prompts) {
        if (!p.description?.trim()) {
          findings.push(
            finding("prompts/described", `prompt \`${p.name}\` has no description`, { target: p.name }),
          );
        }
        for (const arg of p.arguments ?? []) {
          if (!arg.description?.trim()) {
            findings.push(
              finding("prompts/described", `prompt argument \`${p.name}.${arg.name}\` has no description`, {
                target: p.name,
                path: `arguments.${arg.name}`,
              }),
            );
          }
        }
      }
      return { findings };
    },
  },
];

function isAbsoluteUri(uri: string): boolean {
  try {
    new URL(uri);
    return true;
  } catch {
    return false;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
