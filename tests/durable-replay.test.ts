import { it, expect } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const testTempRoot = fileURLToPath(new URL("../.tmp/", import.meta.url));
async function localTemp(prefix: string) {
  await mkdir(testTempRoot, { recursive: true });
  return mkdtemp(join(testTempRoot, prefix));
}
import { join } from "node:path";
import {
  Harness,
  createRegistry,
  defineTool,
  AssistantEntry,
  ToolTask,
} from "@earendil-works/pi-durable";
import {
  createCodemodeExtension,
  CodemodeStoreDoc,
} from "@earendil-works/pi-durable/codemode";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createModels } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { Type } from "typebox";
import { ExpoCodemodeSandbox } from "../src/index.js";
import { NativeEngine } from "./support/native-engine.js";

async function open(
  path: string,
  sandbox: ExpoCodemodeSandbox,
  tools: any[] = [],
) {
  const registry = createRegistry();
  registry.install(createCodemodeExtension({ sandbox, models: false }));
  registry.install({ name: "controlled", tools });
  return Harness.open(
    await openNodeSqliteStorage(path),
    { models: createModels(), registry, onReport: () => {} },
    ctx,
  );
}
async function invoke(harness: any, code: string) {
  const conversation = await harness.root(ctx);
  const id = await harness.commit(async (tx: any) => {
    const entry = await tx.appendEntry(AssistantEntry, conversation.id, {
      model: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "test-call-" + Math.random(),
              name: "codemode",
              arguments: { code },
            },
          ],
          api: "test",
          provider: "test",
          model: "test",
          stopReason: "toolUse",
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        },
      ],
    });
    return tx.createTask(
      ToolTask,
      {
        kind: "model",
        assistant: entry.id,
        callId: entry.model[0].content[0].id,
      },
      {
        conversationId: conversation.id,
        ownership: { kind: "conversation", conversationId: conversation.id },
      },
    );
  }, ctx);
  harness.resume();
  return { id, conversation };
}

it("real Harness + SQLite commits successful native store writes and withholds failed writes", async () => {
  const dir = await localTemp("pi-durable-native-");
  const sandbox = new ExpoCodemodeSandbox({ engine: new NativeEngine() });
  const harness = await open(join(dir, "session.sqlite"), sandbox);
  try {
    const first = await invoke(
      harness,
      'store("saved",{answer:42}); text("done");',
    );
    const receipt = await harness.waitForTask(first.id, ctx);
    expect(receipt).toMatchObject({
      state: { outcome: { status: "completed" } },
    });
    expect(
      await harness.snapshot(CodemodeStoreDoc, first.conversation.id, ctx),
    ).toEqual({ values: { saved: { answer: 42 } } });
    const second = await invoke(
      harness,
      'store("lost",7); throw new Error("abort writes");',
    );
    await harness.waitForTask(second.id, ctx);
    expect(
      await harness.snapshot(CodemodeStoreDoc, first.conversation.id, ctx),
    ).toEqual({ values: { saved: { answer: 42 } } });
  } finally {
    await sandbox.close();
    await harness.close(ctx);
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

for (const mode of [
  "resume",
  "fingerprint-mismatch",
  "unsafe-nested",
] as const) {
  it(`real Harness + SQLite restart: ${mode}`, async () => {
    const dir = await localTemp("pi-restart-native-");
    const path = join(dir, "session.sqlite");
    let resumed = false,
      reads = 0,
      waits = 0,
      after = 0;
    let waiting!: () => void;
    const entered = new Promise<void>((resolve) => (waiting = resolve));
    const tools = [
      defineTool({
        name: "read",
        description: "controlled JSON read",
        parameters: Type.Object({}),
        replay: "safe",
        async execute() {
          reads++;
          return { output: [{ type: "text", text: "recorded-value" }] };
        },
      }),
      defineTool({
        name: "wait",
        description: "controlled pending effect",
        parameters: Type.Object({}),
        replay: mode === "unsafe-nested" ? "unsafe" : "safe",
        async execute(_args, _api, context) {
          waits++;
          if (resumed)
            return { output: [{ type: "text", text: "resumed-value" }] };
          waiting();
          await new Promise<void>((_resolve, reject) => {
            const signal = context.abortSignal!;
            if (signal.aborted) reject(signal.reason);
            else
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
          });
          return {};
        },
      }),
      defineTool({
        name: "after",
        description: "new side effect",
        parameters: Type.Object({}),
        replay: "unsafe",
        async execute() {
          after++;
          return { output: [{ type: "text", text: "after" }] };
        },
      }),
    ];
    const firstSandbox = new ExpoCodemodeSandbox({
      engine: new NativeEngine(),
    });
    let harness = await open(path, firstSandbox, tools);
    let secondSandbox: ExpoCodemodeSandbox | undefined;
    try {
      const code =
        'const value=await tools.read({}); store("pending",value); text(value); try { text(await tools.wait({})); } catch(error) { text("interrupted:"+error.message); } await tools.after({}); store("committed",true);';
      const task = await invoke(harness, code);
      await entered;
      expect(reads).toBe(1);
      expect(waits).toBe(1);
      expect(after).toBe(0);
      expect(
        await harness.snapshot(CodemodeStoreDoc, task.conversation.id, ctx),
      ).toEqual({ values: {} });
      await firstSandbox.close();
      await harness.close(ctx);
      resumed = true;
      secondSandbox = new ExpoCodemodeSandbox({
        engine: new NativeEngine(),
        ...(mode === "fingerprint-mismatch"
          ? { limits: { outputBytes: 900_000 } }
          : {}),
      });
      harness = await open(path, secondSandbox, tools);
      const receipt: any = await harness.waitForTask(task.id, ctx);
      expect(receipt.state.outcome.status).toBe("completed");
      const entry: any = await harness.commit(
        (tx) => tx.entry(receipt.state.outcome.result.entryId),
        ctx,
      );
      const serialized = JSON.stringify(entry.model);
      expect(reads).toBe(1); // completed nested result is journal replay, never another execution
      if (mode === "fingerprint-mismatch") {
        expect(serialized).toContain("sandbox changed");
        expect(after).toBe(0);
        expect(
          await harness.snapshot(CodemodeStoreDoc, task.conversation.id, ctx),
        ).toEqual({ values: {} });
      } else {
        expect(serialized).toContain("recorded-value");
        expect(after).toBe(1);
        expect(waits).toBe(mode === "unsafe-nested" ? 1 : 2);
        if (mode === "unsafe-nested")
          expect(serialized).toContain("interrupted:");
        expect(
          await harness.snapshot(CodemodeStoreDoc, task.conversation.id, ctx),
        ).toEqual({ values: { pending: "recorded-value", committed: true } });
      }
    } finally {
      await firstSandbox.close();
      await secondSandbox?.close();
      await harness.close(ctx);
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
}
it("real Harness + SQLite task abort never commits staged native store writes", async () => {
  const dir = await localTemp("pi-abort-native-");
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => (entered = resolve));
  const wait = defineTool({
    name: "wait",
    description: "controlled abort wait",
    parameters: Type.Object({}),
    replay: "unsafe",
    async execute(_args, _api, context) {
      entered();
      await new Promise<void>((_resolve, reject) =>
        context.abortSignal!.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        ),
      );
      return {};
    },
  });
  const sandbox = new ExpoCodemodeSandbox({ engine: new NativeEngine() });
  const harness = await open(join(dir, "session.sqlite"), sandbox, [wait]);
  try {
    const task = await invoke(
      harness,
      'store("uncommitted",1); await tools.wait({});',
    );
    await waiting;
    await harness.abortTask(task.id, ctx);
    const receipt: any = await harness.waitForTask(task.id, ctx);
    expect(receipt.state.outcome.status).toBe("aborted");
    expect(
      await harness.snapshot(CodemodeStoreDoc, task.conversation.id, ctx),
    ).toEqual({ values: {} });
  } finally {
    await sandbox.close();
    await harness.close(ctx);
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);
