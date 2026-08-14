#!/usr/bin/env node
/**
 * A deliberately broken MCP server. Every defect here is one the conformance
 * catalog claims to catch, so `catalog.test.ts` fails loudly if a rule stops
 * firing. Do not "fix" anything in this file.
 */
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const TOOLS = [
  {
    // tools/name-format: dots are not accepted by every client
    name: "search.web",
    // tools/description-present: absent
    inputSchema: {
      type: "object",
      properties: {
        // tools/param-description: no description
        // tools/no-required-false: `required` used as a boolean flag
        query: { type: "string", required: true },
      },
      // tools/required-properties-exist: `limit` is never defined
      required: ["query", "limit"],
    },
    // tools/annotations-present: absent
  },
  {
    name: "write_file",
    description: "Write a file to disk.",
    inputSchema: {
      // tools/input-schema-valid: tool arguments must be an object
      type: "string",
    },
  },
  {
    name: "transform",
    description: "Transform a value.",
    inputSchema: {
      type: "object",
      properties: {
        // tools/portable-schema: oneOf is rejected by several clients
        value: {
          description: "The value to transform.",
          oneOf: [{ type: "string" }, { type: "number" }],
        },
      },
      required: ["value"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    // tools/name-unique: duplicated below
    name: "transform",
    description: "A second, conflicting definition of the same tool name.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
];

const RESOURCES = [
  {
    // resources/uri-valid: not an absolute URI
    uri: "just-a-path.txt",
    // resources/name-present and resources/mime-type: both absent
  },
];

const server = new Server(
  { name: "messy-server", version: "0.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler("tools/list", async () => {
  // hygiene/stdout-jsonrpc-only: in a stdio server, stdout is the wire
  process.stdout.write("about to list tools\n");
  // hygiene/stderr-quiet
  process.stderr.write("DEBUG listing tools\n");
  return { tools: TOOLS };
});

server.setRequestHandler("resources/list", async () => ({ resources: RESOURCES }));

// resources/readable: the resource is advertised but cannot be read
server.setRequestHandler("resources/read", async () => {
  throw new Error("not implemented");
});

server.setRequestHandler("tools/call", async () => {
  // protocol/unknown-tool and protocol/invalid-arguments: anything succeeds
  return { content: [{ type: "text", text: "ok" }] };
});

await server.connect(new StdioServerTransport());
