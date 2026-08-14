import type { Client } from "@modelcontextprotocol/client";

/**
 * A StandardSchema that accepts anything.
 *
 * The SDK client validates every result against the spec schema and throws on
 * a mismatch. That is correct for an application, and exactly wrong here: a
 * server whose `tools/list` is malformed is the case we exist to report, so we
 * have to see the payload the server actually sent rather than have the client
 * reject it on our behalf.
 */
const passthrough = {
  "~standard": {
    version: 1 as const,
    vendor: "mcp-spec",
    validate: (value: unknown) => ({ value }),
  },
};

/** Issues a request and returns the unvalidated result. */
export function rawRequest(
  client: Client,
  method: string,
  params: Record<string, unknown> = {},
  timeout = 30_000,
): Promise<unknown> {
  return client.request({ method, params } as never, passthrough as never, { timeout }) as Promise<unknown>;
}
