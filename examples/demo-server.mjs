#!/usr/bin/env node
/**
 * A small, well-behaved MCP server used by `npm run selftest`.
 *
 * Written against the low-level `Server` class rather than `McpServer` so the
 * exact JSON shipped in `tools/list` is visible here — which is the whole
 * subject of the conformance catalog.
 */
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const TOOLS = [
  {
    name: "echo",
    description: "Return the supplied message unchanged. Useful for connectivity checks.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The text to echo back." },
      },
      required: ["message"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "add",
    description: "Add two numbers and return the sum.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "The first addend." },
        b: { type: "number", description: "The second addend." },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
];

const RESOURCES = [
  {
    uri: "demo://readme",
    name: "Demo readme",
    description: "A short text resource served by the demo server.",
    mimeType: "text/plain",
  },
];

const server = new Server(
  { name: "mcp-spec-demo", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler("tools/list", async () => ({ tools: TOOLS }));

server.setRequestHandler("resources/list", async () => ({ resources: RESOURCES }));

server.setRequestHandler("resources/read", async (request) => {
  const { uri } = request.params;
  if (uri !== "demo://readme") {
    return { isError: true, contents: [] };
  }
  return {
    contents: [{ uri, mimeType: "text/plain", text: "Hello from the mcp-spec demo server." }],
  };
});

server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === "echo") {
    if (typeof args.message !== "string") {
      return { isError: true, content: [{ type: "text", text: "`message` must be a string" }] };
    }
    return { content: [{ type: "text", text: args.message }] };
  }

  if (name === "add") {
    if (typeof args.a !== "number" || typeof args.b !== "number") {
      return { isError: true, content: [{ type: "text", text: "`a` and `b` must be numbers" }] };
    }
    return { content: [{ type: "text", text: String(args.a + args.b) }] };
  }

  return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] };
});

await server.connect(new StdioServerTransport());
