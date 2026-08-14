import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Transport } from "@modelcontextprotocol/client";
import { ObservedStdioTransport } from "./transport/observed-stdio.js";
import { isHttpTarget, type ServerTarget } from "./types.js";

export interface Session {
  client: Client;
  /** Milliseconds from spawn/dial to a completed `initialize`. */
  startupMs: number;
  /** Transport errors seen at any point, including after connect. */
  transportErrors: string[];
  /** stdout lines that were not JSON-RPC frames (stdio only). */
  junkLines(): string[];
  /** Everything the child wrote to stderr (stdio only). */
  stderr(): string;
  close(): Promise<void>;
}

export class ConnectError extends Error {}

export function describeTarget(target: ServerTarget): string {
  if (isHttpTarget(target)) return target.url;
  return [target.command, ...(target.args ?? [])].join(" ");
}

/**
 * Connects and initializes. Errors here are fatal to the run — there is
 * nothing to lint if the handshake never completed.
 */
export async function connect(target: ServerTarget, opts: { cwd?: string; timeout?: number } = {}): Promise<Session> {
  const transportErrors: string[] = [];

  let transport: Transport;
  let stdio: ObservedStdioTransport | undefined;

  if (isHttpTarget(target)) {
    transport = new StreamableHTTPClientTransport(new URL(target.url), {
      requestInit: target.headers ? { headers: target.headers } : undefined,
    });
  } else {
    stdio = new ObservedStdioTransport({
      command: target.command,
      args: target.args,
      cwd: target.cwd ?? opts.cwd,
      env: target.env,
    });
    transport = stdio;
  }

  transport.onerror = (err: Error) => {
    transportErrors.push(err.message);
  };

  const client = new Client(
    { name: "mcp-spec", version: "0.1.0" },
    { capabilities: {} },
  );

  const started = Date.now();
  try {
    await withTimeout(
      client.connect(transport),
      opts.timeout ?? 30_000,
      `server did not complete \`initialize\` within ${opts.timeout ?? 30_000}ms`,
    );
  } catch (err) {
    await transport.close().catch(() => {});
    const detail = stdio?.stderr.trim() ?? "";
    throw new ConnectError(
      `failed to connect to ${describeTarget(target)}: ${err instanceof Error ? err.message : String(err)}` +
        (detail ? `\n\nserver stderr:\n${indent(detail)}` : ""),
    );
  }
  const startupMs = Date.now() - started;

  return {
    client,
    startupMs,
    transportErrors,
    junkLines: () => stdio?.junkLines ?? [],
    stderr: () => stdio?.stderr ?? "",
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}
