import type { Rule } from "../types.js";
import { finding } from "./util.js";

/**
 * Lines a server writes to stderr that are almost always accidental debug
 * output rather than a real diagnostic.
 */
const NOISE = /^(?:\s*(?:console\.|DEBUG|debug:|\[debug\])|\s*\{\s*"jsonrpc")/i;

export const hygieneRules: Rule[] = [
  {
    name: "hygiene/stdout-jsonrpc-only",
    category: "hygiene",
    description: "nothing but JSON-RPC frames reach stdout",
    defaultSeverity: "error",
    run(ctx) {
      // The SDK's own ReadBuffer discards unparseable lines silently, so this
      // is invisible to every client — including the one the user is debugging
      // with. Our transport keeps them.
      if (ctx.junkLines.length === 0) return { findings: [] };
      return {
        findings: [
          finding(
            "hygiene/stdout-jsonrpc-only",
            `${ctx.junkLines.length} non-JSON-RPC line(s) written to stdout`,
            {
              hint:
                "in a stdio server stdout is the wire — clients drop these lines silently, so " +
                `the symptom is a hang or a missing response. Log to stderr instead. First: ${truncate(ctx.junkLines[0]!, 100)}`,
            },
          ),
        ],
      };
    },
  },

  {
    name: "hygiene/startup-time",
    category: "hygiene",
    description: "initialize completes inside the startup budget",
    defaultSeverity: "warn",
    run(ctx) {
      const budget = ctx.startupBudget;
      if (ctx.startupMs <= budget) return { findings: [], stats: { startupMs: ctx.startupMs } };
      return {
        stats: { startupMs: ctx.startupMs },
        findings: [
          finding(
            "hygiene/startup-time",
            `initialize took ${ctx.startupMs}ms, over the budget of ${budget}ms`,
            {
              hint: "clients spawn every configured server at session start; slow servers delay the whole session",
            },
          ),
        ],
      };
    },
  },

  {
    name: "hygiene/stderr-quiet",
    category: "hygiene",
    description: "the server does not spray debug output to stderr on a clean run",
    defaultSeverity: "warn",
    run(ctx) {
      const lines = ctx.stderr.split("\n").filter((l) => l.trim());
      const noisy = lines.filter((l) => NOISE.test(l));
      if (noisy.length === 0) return { findings: [] };
      return {
        findings: [
          finding("hygiene/stderr-quiet", `${noisy.length} debug line(s) written to stderr during a clean run`, {
            hint: `clients surface stderr in logs and error toasts (first: ${truncate(noisy[0]!, 120)})`,
          }),
        ],
      };
    },
  },

  {
    name: "hygiene/no-empty-surface",
    category: "hygiene",
    description: "the server exposes at least one tool, resource or prompt",
    defaultSeverity: "error",
    run(ctx) {
      if (ctx.tools.length + ctx.resources.length + ctx.prompts.length > 0) return { findings: [] };
      return {
        findings: [
          finding("hygiene/no-empty-surface", "server exposes no tools, resources or prompts", {
            hint: "the handshake succeeds but there is nothing for a model to use",
          }),
        ],
      };
    },
  },
];

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
