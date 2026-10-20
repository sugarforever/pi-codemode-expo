// CI-only host transport adapted from expo-quickjs 85b5a08 (MIT).
// Captures terminal events and joins child close before releasing the harness.
// No native VM or published package source is changed by this fixture.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeTransport, NativeEvent } from "../src/core.ts";
export class HostNativeTransport implements NativeTransport {
  listener?: (event: NativeEvent) => void;
  children = new Map<string, ChildProcessWithoutNullStreams>();
  private terminal = new Set<string>();
  private ended = new Map<string, Promise<void>>();
  addListener(_name: string, fn: (event: NativeEvent) => void) {
    this.listener = fn;
    return {
      remove: () => {
        this.listener = undefined;
      },
    };
  }
  async start(id: string, bootstrap: string, data: string, limits: string) {
    const dir = mkdtempSync(join(tmpdir(), "expo-qjs-"));
    writeFileSync(join(dir, "bootstrap.js"), bootstrap);
    writeFileSync(join(dir, "data.json"), data);
    const l = JSON.parse(limits);
    const child = spawn(join(process.cwd(), "build/channel_runner"), [
      join(dir, "bootstrap.js"),
      join(dir, "data.json"),
      ...[
        "timeoutMs",
        "memoryBytes",
        "stackBytes",
        "outputBytes",
        "messageBytes",
        "maxHostCalls",
      ].map((key) => String(l[key])),
    ]);
    this.children.set(id, child);
    let buffer = "",
      failure: Error | undefined;
    let resolveEnd!: () => void;
    this.ended.set(id, new Promise<void>((resolve) => (resolveEnd = resolve)));
    const watchdog = setTimeout(
      () => child.kill("SIGKILL"),
      Math.min(l.timeoutMs + 5000, 30000),
    );
    // EPIPE can arrive before 'close' after a legitimate native terminal event.
    // Defer classification until stdout has drained; never throw from a pipe listener.
    child.stdin.on("error", (error) => {
      failure = error;
    });
    child.on("error", (error) => {
      failure = error;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const event = { ...JSON.parse(line), runId: id };
        if (event.type === "terminal") this.terminal.add(id);
        this.listener?.(event);
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.once("close", () => {
      clearTimeout(watchdog);
      this.children.delete(id);
      this.ended.delete(id);
      rmSync(dir, { recursive: true, force: true });
      if (!this.terminal.delete(id))
        this.listener?.({
          runId: id,
          type: "terminal",
          status: "native-error",
          error:
            failure?.message ??
            "Native test runner exited without terminal event",
        });
      resolveEnd();
    });
  }
  async deliver(id: string, message: string) {
    this.children
      .get(id)
      ?.stdin.write(`${JSON.parse(message).id}\t${message}\n`);
  }
  async stop(id: string) {
    const child = this.children.get(id),
      ended = this.ended.get(id);
    if (!child) return;
    if (
      !this.terminal.has(id) &&
      child.exitCode === null &&
      !child.stdin.destroyed &&
      !child.stdin.writableEnded
    )
      child.stdin.end("stop\n");
    await ended;
  }
  async close() {
    await Promise.all([...this.children.keys()].map((id) => this.stop(id)));
  }
}
