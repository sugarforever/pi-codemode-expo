import { it, expect } from "vitest";
import { ExpoCodemodeSandbox } from "../src/index.js";
import type { NativeEvent, QuickJSChannelEngine } from "../src/protocol.js";

it("passes bootstrap and effective limits; sends replies and stops once", async () => {
  let callback: (event: NativeEvent) => void;
  let runId = "";
  let stops = 0;
  const engine: QuickJSChannelEngine = {
    async start(options, onEvent) {
      callback = onEvent;
      runId = options.runId;
      expect(options.bootstrap).toContain("bootstrapRuntime");
      expect(options.limits?.memoryBytes).toBe(16 * 1024 * 1024);
      expect((options.data as any).code).toBe("return await tools.echo(1)");
      queueMicrotask(() =>
        callback({
          runId,
          type: "message",
          json: '{"type":"call","id":1,"target":"tool","name":"echo","args":"1"}',
        }),
      );
    },
    async deliver(id, message) {
      expect(id).toBe(runId);
      expect((message as any).payload).toBe("2");
      callback({
        runId,
        type: "terminal",
        status: "ok",
        json: '{"type":"done","ok":true,"value":"2","writes":"[]"}',
      });
    },
    async stop(id) {
      expect(id).toBe(runId);
      stops++;
    },
  };
  const sandbox = new ExpoCodemodeSandbox({
    engine,
    engineRevision: "test-native",
    memoryLimitBytes: 16 * 1024 * 1024,
    tools: [{ name: "echo", execute: async () => 2 }],
  });
  expect(await sandbox.execute("return await tools.echo(1)")).toMatchObject({
    ok: true,
    value: 2,
  });
  await sandbox.close();
  expect(stops).toBe(1);
});
it("maps native failures and ignores events after stop", async () => {
  let stops = 0;
  const engine: QuickJSChannelEngine = {
    async start(options, event) {
      queueMicrotask(() =>
        event({
          runId: options.runId,
          type: "terminal",
          status: "resource-limit",
          error: "output budget",
        }),
      );
    },
    async deliver() {},
    async stop() {
      stops++;
    },
  };
  const sandbox = new ExpoCodemodeSandbox({
    engine,
    engineRevision: "test-native",
  });
  expect(await sandbox.execute("text(1)")).toMatchObject({
    ok: false,
    error: { kind: "sandbox", message: "output budget" },
  });
  await sandbox.close();
  expect(stops).toBe(1);
});
it("does not admit pre-aborted runs and validates limits", async () => {
  let starts = 0;
  const engine: QuickJSChannelEngine = {
    async start() {
      starts++;
    },
    async deliver() {},
    async stop() {},
  };
  expect(
    () => new ExpoCodemodeSandbox({ engine, limits: { outputBytes: 0 } }),
  ).toThrow(/outputBytes/);
  const sandbox = new ExpoCodemodeSandbox({ engine });
  const controller = new AbortController();
  controller.abort();
  expect(
    await sandbox.execute("return 1", { signal: controller.signal }),
  ).toMatchObject({ ok: false, error: { kind: "aborted" } });
  expect(starts).toBe(0);
});
it("close joins native admission that is still pending", async () => {
  let release!: () => void;
  let stopped = false;
  const admission = new Promise<void>((resolve) => (release = resolve));
  const engine: QuickJSChannelEngine = {
    async start() {
      await admission;
    },
    async deliver() {},
    async stop() {
      stopped = true;
    },
  };
  const sandbox = new ExpoCodemodeSandbox({ engine });
  const result = sandbox.execute("return 1");
  let closed = false;
  const close = sandbox.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(closed).toBe(false);
  expect(stopped).toBe(false);
  release();
  await close;
  expect(stopped).toBe(true);
  expect(await result).toMatchObject({ ok: false, error: { kind: "aborted" } });
});
it("surfaces native stop/join rejection in execute and close", async () => {
  let callback!: (event: NativeEvent) => void;
  let runId = "";
  const engine: QuickJSChannelEngine = {
    async start(options, event) {
      runId = options.runId;
      callback = event;
    },
    async deliver() {},
    async stop() {
      throw Error("native join failed");
    },
  };
  const sandbox = new ExpoCodemodeSandbox({ engine });
  const executing = sandbox.execute("return 1");
  callback({
    runId,
    type: "terminal",
    status: "ok",
    json: '{"type":"done","ok":true,"value":"1","writes":"[]"}',
  });
  expect(await executing).toMatchObject({
    ok: false,
    error: {
      kind: "sandbox",
      message: expect.stringContaining("native join failed"),
    },
  });
  await expect(sandbox.close()).rejects.toThrow(/stop|join/);
});
it("requires native identity before deterministic admission and fingerprints platform/build identity", async () => {
  let starts = 0;
  const unidentified: QuickJSChannelEngine = {
    async start() {
      starts++;
    },
    async deliver() {},
    async stop() {},
  };
  const denied = new ExpoCodemodeSandbox({ engine: unidentified });
  const run = denied.start("return 1", {
    startedAt: 0,
    seed: 0,
    onCall() {},
    timeoutMs: 100,
  });
  expect(await run.result).toMatchObject({
    ok: false,
    error: { kind: "sandbox", message: expect.stringContaining("identity") },
  });
  expect(starts).toBe(0);
  await denied.close();
  const identified: QuickJSChannelEngine = {
    identity: "quickjs-test ios arm64 build-7",
    async start(options, event) {
      expect(options.bootstrap).toContain("quickjs-test ios arm64 build-7");
      queueMicrotask(() =>
        event({
          runId: options.runId,
          type: "terminal",
          status: "ok",
          json: '{"type":"done","ok":true,"value":"1","writes":"[]"}',
        }),
      );
    },
    async deliver() {},
    async stop() {},
  };
  const sandbox = new ExpoCodemodeSandbox({ engine: identified });
  expect(
    await sandbox.start("return 1", { startedAt: 0, seed: 0, onCall() {} })
      .result,
  ).toMatchObject({ ok: true, value: 1 });
  await sandbox.close();
});
