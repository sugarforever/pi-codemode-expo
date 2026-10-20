import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type {
  QuickJSChannelEngine,
  NativeEvent,
  JsonValue,
} from "../../src/protocol.js";
/** Real native C++ QuickJS runner, out of process with an independent kill watchdog. */
export class NativeEngine implements QuickJSChannelEngine {
  readonly identity: string;
  private runs = new Map<
    string,
    {
      child: ChildProcessWithoutNullStreams;
      ended: Promise<void>;
      dir: string;
      terminal: () => boolean;
    }
  >();
  constructor(
    private runner = process.env.EXPO_QUICKJS_RUNNER ??
      fileURLToPath(
        new URL("../../../expo-quickjs/build/channel_runner", import.meta.url),
      ),
    private timezone?: string,
  ) {
    this.identity = `quickjs-2025-09-13; host ${process.platform} ${process.arch}; runner ${createHash("sha256").update(readFileSync(runner)).digest("hex")}`;
  }
  async start(
    options: Parameters<QuickJSChannelEngine["start"]>[0],
    onEvent: (event: NativeEvent) => void,
  ) {
    const tempRoot = fileURLToPath(new URL("../../.tmp/", import.meta.url));
    await mkdir(tempRoot, { recursive: true });
    const dir = await mkdtemp(join(tempRoot, "pi-native-"));
    await writeFile(join(dir, "bootstrap.js"), options.bootstrap);
    await writeFile(join(dir, "data.json"), JSON.stringify(options.data));
    const l = options.limits!;
    const child = spawn(
      this.runner,
      [
        join(dir, "bootstrap.js"),
        join(dir, "data.json"),
        String(l.timeoutMs),
        String(l.memoryBytes),
        String(l.stackBytes),
        String(l.outputBytes),
        String(l.messageBytes),
        String(l.maxHostCalls),
      ],
      {
        env: this.timezone
          ? { ...process.env, TZ: this.timezone }
          : process.env,
      },
    );
    let stderr = "";
    let terminal = false;
    const kill = setTimeout(
      () => {
        child.kill("SIGKILL");
      },
      Math.min((l.timeoutMs ?? 10_000) + 5000, 25_000),
    );
    child.stderr.on("data", (data) => (stderr += data));
    child.stdin.on("error", (error) => {
      if (!terminal)
        onEvent({
          runId: options.runId,
          type: "terminal",
          status: "native-error",
          error: String(error),
        });
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === "terminal") terminal = true;
        onEvent({ ...event, runId: options.runId });
      } catch (error) {
        onEvent({
          runId: options.runId,
          type: "terminal",
          status: "native-error",
          error: String(error),
        });
      }
    });
    const ended = new Promise<void>((resolve) => {
      child.on("close", () => {
        clearTimeout(kill);
        if (!terminal)
          onEvent({
            runId: options.runId,
            type: "terminal",
            status: "native-error",
            error: stderr || "runner exited without terminal",
          });
        resolve();
      });
      child.on("error", (error) =>
        onEvent({
          runId: options.runId,
          type: "terminal",
          status: "native-error",
          error: String(error),
        }),
      );
    });
    this.runs.set(options.runId, {
      child,
      ended,
      dir,
      terminal: () => terminal,
    });
  }
  async deliver(runId: string, message: JsonValue) {
    const run = this.runs.get(runId);
    if (!run) throw Error("Unknown native run");
    run.child.stdin.write(
      `${(message as { id: number }).id}\t${JSON.stringify(message)}\n`,
    );
  }
  async stop(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    if (!run.terminal() && !run.child.stdin.destroyed)
      run.child.stdin.end("stop\n");
    await run.ended;
    await rm(run.dir, { recursive: true, force: true });
  }
  async close() {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }
}
