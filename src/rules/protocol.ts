import type { Rule } from "../types.js";
import { rawRequest } from "../raw.js";
import { finding, isRecord } from "./util.js";

/** JSON-RPC reserved code for an unimplemented method. */
const METHOD_NOT_FOUND = -32601;

export const protocolRules: Rule[] = [
  {
    name: "protocol/server-info",
    category: "protocol",
    description: "initialize returns serverInfo with a name and a version",
    defaultSeverity: "warn",
    run(ctx) {
      const findings = [];
      if (!ctx.serverInfo?.name) {
        findings.push(
          finding("protocol/server-info", "server did not report an implementation name", {
            hint: "clients show this in server pickers and logs",
          }),
        );
      }
      if (!ctx.serverInfo?.version) {
        findings.push(
          finding("protocol/server-info", "server did not report a version", {
            hint: "without a version, users cannot tell which build they are running",
          }),
        );
      }
      return { findings };
    },
  },

  {
    name: "protocol/ping",
    category: "protocol",
    description: "server answers the ping utility method",
    defaultSeverity: "warn",
    async run(ctx) {
      try {
        await ctx.client.ping();
        return { findings: [] };
      } catch (err) {
        return {
          findings: [
            finding("protocol/ping", `ping failed: ${message(err)}`, {
              hint: "clients use ping for liveness; failing it can look like a hung server",
            }),
          ],
        };
      }
    },
  },

  {
    name: "protocol/capabilities-declared",
    category: "protocol",
    description: "every primitive the server actually serves is declared in capabilities",
    defaultSeverity: "error",
    run(ctx) {
      const caps = ctx.capabilities ?? {};
      const findings = [];
      const pairs: Array<[string, number]> = [
        ["tools", ctx.tools.length],
        ["resources", ctx.resources.length],
        ["prompts", ctx.prompts.length],
      ];
      for (const [name, count] of pairs) {
        if (count > 0 && !isRecord(caps[name])) {
          findings.push(
            finding(
              "protocol/capabilities-declared",
              `server serves ${count} ${name} but does not declare the \`${name}\` capability`,
              {
                target: name,
                hint: `clients skip \`${name}/list\` entirely when the capability is absent, so these are invisible`,
              },
            ),
          );
        }
      }
      return { findings };
    },
  },

  {
    name: "protocol/unknown-method",
    category: "protocol",
    description: "an unimplemented method returns -32601 instead of hanging or crashing",
    defaultSeverity: "warn",
    async run(ctx) {
      try {
        await rawRequest(ctx.client, "mcpSpec/doesNotExist", {}, 5000);
        return {
          findings: [
            finding("protocol/unknown-method", "server returned a result for a method it does not implement", {
              hint: "unknown methods must fail with JSON-RPC error -32601 (Method not found)",
            }),
          ],
        };
      } catch (err) {
        const code = errorCode(err);
        if (code === METHOD_NOT_FOUND) return { findings: [] };
        return {
          findings: [
            finding(
              "protocol/unknown-method",
              code === undefined
                ? `unknown method produced a non-protocol failure: ${message(err)}`
                : `unknown method returned code ${code}, expected ${METHOD_NOT_FOUND}`,
              { hint: "a wrong code makes clients report a server crash instead of an unsupported feature" },
            ),
          ],
        };
      }
    },
  },

  {
    name: "protocol/unknown-tool",
    category: "protocol",
    description: "calling a tool that does not exist fails cleanly",
    defaultSeverity: "error",
    requires: "tools",
    async run(ctx) {
      const name = "mcp_spec_nonexistent_tool";
      try {
        const result = (await rawRequest(ctx.client, "tools/call", { name, arguments: {} }, 5000)) as {
          isError?: boolean;
        };
        if (result.isError === true) return { findings: [] };
        return {
          findings: [
            finding("protocol/unknown-tool", `calling the undefined tool \`${name}\` returned a success result`, {
              target: name,
              hint: "return a JSON-RPC error or a result with isError: true so the model knows the call failed",
            }),
          ],
        };
      } catch (err) {
        // A thrown protocol error is the correct outcome. Anything that looks
        // like a transport death is not.
        if (errorCode(err) !== undefined) return { findings: [] };
        return {
          findings: [
            finding("protocol/unknown-tool", `calling an undefined tool broke the session: ${message(err)}`, {
              target: name,
              hint: "unknown tool names must be handled, not thrown past the transport",
            }),
          ],
        };
      }
    },
  },

  {
    name: "protocol/invalid-arguments",
    category: "protocol",
    description: "a tool call violating the declared input schema is rejected",
    defaultSeverity: "warn",
    requires: "tools",
    async run(ctx) {
      // Pick the first tool with a required property we can deliberately omit
      // while sending something obviously wrong in its place.
      const candidate = ctx.tools.find((t) => {
        const schema = t.inputSchema;
        return isRecord(schema) && Array.isArray(schema.required) && schema.required.length > 0;
      });
      if (!candidate) return { findings: [] };

      const required = (candidate.inputSchema as { required: string[] }).required;
      const bogus = Object.fromEntries(required.map((key) => [key, { __mcpSpecWrongType: true }]));

      try {
        const result = (await rawRequest(
          ctx.client,
          "tools/call",
          { name: candidate.name, arguments: bogus },
          5000,
        )) as { isError?: boolean };
        if (result.isError === true) return { findings: [] };
        return {
          findings: [
            finding(
              "protocol/invalid-arguments",
              `\`${candidate.name}\` accepted arguments that violate its own inputSchema`,
              {
                target: candidate.name,
                hint: "validate arguments against inputSchema — models do send malformed calls",
              },
            ),
          ],
        };
      } catch (err) {
        if (errorCode(err) !== undefined) return { findings: [] };
        return {
          findings: [
            finding(
              "protocol/invalid-arguments",
              `\`${candidate.name}\` crashed on schema-violating arguments: ${message(err)}`,
              { target: candidate.name, hint: "reject bad arguments instead of letting the handler throw" },
            ),
          ],
        };
      }
    },
  },
];

function errorCode(err: unknown): number | undefined {
  if (isRecord(err) && typeof err.code === "number") return err.code;
  return undefined;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
