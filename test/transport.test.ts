import { describe, expect, it } from "vitest";
import { ObservedStdioTransport } from "../src/transport/observed-stdio.js";

/** Resolves to `false` if the promise has not settled in time. */
function within<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

describe("ObservedStdioTransport", () => {
  it("close() resolves when the child exited but its pipes are still held", async () => {
    // Regression: close() awaited `child.once("exit")` unconditionally. Once
    // the process had already exited that event never fired again, so close()
    // hung forever and took the whole run with it.
    //
    // Reaching that state needs `exit` fired but `close` not yet — which is
    // what happens when the server spawns a grandchild that inherits stdout
    // and then exits. The pipe stays open, so `close` never arrives and
    // `this.child` is still set. Servers that shell out do this for real.
    const transport = new ObservedStdioTransport({
      command: process.execPath,
      args: [
        "-e",
        `require("child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{}, 3000)"],
           { stdio: ["ignore", "inherit", "inherit"], detached: true }).unref();
         process.exit(0);`,
      ],
    });
    await transport.start();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await within(transport.close(), 2000)).toBe(true);
  }, 15_000);

  it("close() resolves for a server that ignores stdin closing", async () => {
    const transport = new ObservedStdioTransport({
      command: process.execPath,
      args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
    });
    await transport.start();

    // The polite SIGTERM lands at 1s, the hard stop at 3s.
    expect(await within(transport.close(), 5000)).toBe(true);
  }, 10_000);

  it("close() is idempotent", async () => {
    const transport = new ObservedStdioTransport({
      command: process.execPath,
      args: ["-e", ""],
    });
    await transport.start();
    await transport.close();
    expect(await within(transport.close(), 500)).toBe(true);
  });

  it("keeps non-JSON-RPC stdout lines instead of discarding them", async () => {
    const transport = new ObservedStdioTransport({
      command: process.execPath,
      args: [
        "-e",
        // A log line, a JSON line that is not JSON-RPC, and a valid frame.
        `console.log("starting up");
         console.log(JSON.stringify({ level: "info", msg: "ready" }));
         console.log(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));`,
      ],
    });
    const messages: unknown[] = [];
    transport.onmessage = (m) => messages.push(m);
    await transport.start();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(transport.junkLines).toEqual([
      "starting up",
      JSON.stringify({ level: "info", msg: "ready" }),
    ]);
    expect(messages).toHaveLength(1);
    await transport.close();
  });

  it("captures stderr separately from stdout", async () => {
    const transport = new ObservedStdioTransport({
      command: process.execPath,
      args: ["-e", `console.error("DEBUG something");`],
    });
    await transport.start();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(transport.stderr).toContain("DEBUG something");
    expect(transport.junkLines).toEqual([]);
    await transport.close();
  });
});
