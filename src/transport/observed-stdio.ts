import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

export interface ObservedStdioOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * A stdio transport that records what the SDK's own transport throws away.
 *
 * `ReadBuffer` in the SDK swallows `SyntaxError` and moves to the next line,
 * so a server that writes anything non-JSON to stdout — a stray `console.log`,
 * a banner, a progress bar — corrupts the stream invisibly. That is one of the
 * most common ways a stdio server breaks in the wild, and nothing surfaces it.
 *
 * This implementation is deliberately thin, and keeps every discarded line so
 * `hygiene/stdout-jsonrpc-only` can report it.
 */
export class ObservedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /** Lines received on stdout that were not JSON-RPC. */
  readonly junkLines: string[] = [];
  private stderrBuffer = "";
  private buffer = "";
  private child?: ChildProcessWithoutNullStreams;
  private closed = false;

  constructor(private readonly options: ObservedStdioOptions) {}

  get stderr(): string {
    return this.stderrBuffer;
  }

  start(): Promise<void> {
    if (this.child) throw new Error("transport already started");
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: { ...getDefaultEnvironment(), ...(this.options.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: process.platform === "win32",
      }) as ChildProcessWithoutNullStreams;
      this.child = child;

      child.on("error", (err) => {
        reject(err);
        this.onerror?.(err);
      });
      child.on("spawn", () => resolve());
      child.on("close", () => {
        this.child = undefined;
        if (!this.closed) {
          this.closed = true;
          this.onclose?.();
        }
      });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.ingest(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.stderrBuffer += chunk;
      });
      child.stdin.on("error", (err) => this.onerror?.(err));
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index === -1) break;
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.junkLines.push(line);
        continue;
      }
      // Valid JSON is not automatically a JSON-RPC frame; a server printing a
      // JSON log line is the same bug with a subtler symptom.
      if (!isJsonRpc(parsed)) {
        this.junkLines.push(line);
        continue;
      }
      this.onmessage?.(parsed as JSONRPCMessage);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const child = this.child;
    if (!child) throw new Error("transport is not connected");
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.stdin.end();
    // Give the server a beat to exit on its own before insisting.
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const timer = setTimeout(() => child.kill(), 1000);
    await exited.finally(() => clearTimeout(timer));
    this.onclose?.();
  }
}

function isJsonRpc(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0"
  );
}
