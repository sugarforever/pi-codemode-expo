import { it, expect } from "vitest";
import { ExpoCodemodeSandbox } from "../src/index.js";
import { NativeEngine } from "./support/native-engine.js";

it("real native QuickJS: async tools, globals, helpers, store, errors and capability isolation", async () => {
  const sandbox = new ExpoCodemodeSandbox({
    engine: new NativeEngine(),
    tools: [{ name: "echo", execute: async (args) => args }],
    globals: [
      {
        name: "add",
        spread: true,
        execute: (args) => (args as number[]).reduce((a, b) => a + b, 0),
      },
    ],
  });
  try {
    const result = await sandbox.execute(
      'text("你好 🌲"); store("x",await tools.echo({value:7})); return [await add(2,3),load("x"),typeof fetch,typeof process,typeof require,typeof __emit,typeof __receive];',
    );
    expect(result).toMatchObject({
      ok: true,
      value: [
        5,
        { value: 7 },
        "undefined",
        "undefined",
        "undefined",
        "undefined",
        "undefined",
      ],
      output: [{ type: "text", text: "你好 🌲" }],
      storeWrites: { set: { x: { value: 7 } }, delete: [] },
    });
    expect(
      await sandbox.execute('store("lost",1); throw new Error("script boom")'),
    ).toMatchObject({
      ok: false,
      error: { kind: "script", message: "script boom" },
    });
    expect(await sandbox.execute("return typeof x")).toMatchObject({
      ok: true,
      value: "undefined",
    });
  } finally {
    await sandbox.close();
  }
}, 15_000);

it("real native QuickJS: deterministic virtual UTC, random and ordered result delivery", async () => {
  async function once() {
    const sandbox = new ExpoCodemodeSandbox({ engine: new NativeEngine() });
    const calls: any[] = [];
    const idle: any[] = [];
    let fp = "";
    const run = sandbox.start(
      'text([Date.now(),Math.random(),new Date(2020,0,1).toISOString(),typeof WeakRef]); await Promise.all([tools.echo(1).then(()=>text(Date.now())),tools.echo(2).then(()=>text(Date.now()))]); return "done";',
      {
        startedAt: 1700000000000,
        seed: 42,
        tools: [{ name: "echo" }],
        onStarted: (f) => (fp = f),
        onCall: (c) => calls.push(c),
        onIdle: (seq, issued) => idle.push({ seq, issued }),
        timeoutMs: 5000,
      },
    );
    await expect.poll(() => calls.length).toBe(2);
    run.deliver(2, 1700000000200, 2, { ok: true, value: 2 });
    run.deliver(1, 1700000000100, 1, { ok: true, value: 1 });
    const result = await run.result;
    await sandbox.close();
    return { result, idle, fp };
  }
  const a = await once(),
    b = await once();
  expect(a.result).toMatchObject({
    ok: true,
    value: "done",
    output: [
      {
        type: "text",
        text: expect.stringContaining("2020-01-01T00:00:00.000Z"),
      },
      { type: "text", text: "1700000000100" },
      { type: "text", text: "1700000000200" },
    ],
    during: { seq: 2, issued: 2 },
  });
  expect(a.result.output).toEqual(b.result.output);
  expect(a.fp).toEqual(b.fp);
  expect(a.fp).toContain("quickjs-2025-09-13");
  expect(a.idle).toEqual([
    { seq: 0, issued: 2 },
    { seq: 1, issued: 2 },
  ]);
}, 15_000);

it("real native QuickJS: Promise.all preserves input order while tools finish out of order", async () => {
  const completion: number[] = [];
  const sandbox = new ExpoCodemodeSandbox({
    engine: new NativeEngine(),
    tools: [
      {
        name: "echo",
        execute: async (args) => {
          const n = args as number;
          await new Promise((resolve) => setTimeout(resolve, n === 1 ? 15 : 1));
          completion.push(n);
          return n;
        },
      },
    ],
  });
  try {
    expect(
      await sandbox.execute(
        "return await Promise.all([tools.echo(1),tools.echo(2)]);",
      ),
    ).toMatchObject({ ok: true, value: [1, 2] });
    expect(completion).toEqual([2, 1]);
  } finally {
    await sandbox.close();
  }
});

it("real native QuickJS: native deadline interrupts CPU and microtask loops under external watchdog", async () => {
  for (const code of ["while(true) {}", "while(true) await null;"]) {
    const sandbox = new ExpoCodemodeSandbox({
      engine: new NativeEngine(),
      timeoutMs: 2000,
      limits: { timeoutMs: 50 },
    });
    try {
      expect(await sandbox.execute(code)).toMatchObject({
        ok: false,
        error: { kind: "timeout" },
      });
    } finally {
      await sandbox.close();
    }
  }
}, 10_000);

it("real native QuickJS: output and concurrent call budgets cannot be caught around", async () => {
  for (const [code, limits] of [
    [
      'try { text("🌲".repeat(1000)); } catch {} return "escaped";',
      { outputBytes: 256 },
    ],
    [
      'try { await Promise.all([tools.echo(1),tools.echo(2),tools.echo(3)]); } catch {} return "escaped";',
      { maxHostCalls: 2 },
    ],
  ] as const) {
    const sandbox = new ExpoCodemodeSandbox({
      engine: new NativeEngine(),
      limits,
      tools: [
        {
          name: "echo",
          execute: async (_args, { signal }) =>
            new Promise((_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(Error("cancelled")),
                { once: true },
              ),
            ),
        },
      ],
    });
    try {
      expect(await sandbox.execute(code)).toMatchObject({
        ok: false,
        error: { kind: "sandbox" },
      });
    } finally {
      await sandbox.close();
    }
  }
}, 10_000);

it("real native QuickJS: host errors, abort while awaiting tools and failed store writes", async () => {
  let interrupted = false;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const sandbox = new ExpoCodemodeSandbox({
    engine: new NativeEngine(),
    tools: [
      {
        name: "fail",
        execute: () => {
          throw Error("host boom");
        },
      },
      {
        name: "wait",
        execute: async (_args, { signal }) => {
          enter();
          await new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => {
                interrupted = true;
                reject(Error("aborted"));
              },
              { once: true },
            ),
          );
        },
      },
    ],
  });
  try {
    expect(
      await sandbox.execute(
        "try { await tools.fail(); } catch(error) { return error.message; }",
      ),
    ).toMatchObject({ ok: true, value: "host boom" });
    const controller = new AbortController();
    const pending = sandbox.execute('store("lost",7); await tools.wait();', {
      signal: controller.signal,
    });
    await entered;
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: { kind: "aborted" },
    });
    expect(interrupted).toBe(true);
    const result = await sandbox.execute('return load("lost");');
    expect(result).toMatchObject({ ok: true, value: undefined });
  } finally {
    await sandbox.close();
  }
});
it("real native QuickJS: structured error properties and image/exit helpers", async () => {
  const sandbox = new ExpoCodemodeSandbox({ engine: new NativeEngine() });
  try {
    let answer!: (call: any) => void;
    const called = new Promise<any>((resolve) => (answer = resolve));
    const run = sandbox.start(
      "try { await tools.echo({}); } catch(error) { return [error.message,error.structuredOutput,error.name]; }",
      { startedAt: 0, seed: 0, tools: [{ name: "echo" }], onCall: answer },
    );
    const call = await called;
    run.deliver(1, 1, call.id, {
      ok: false,
      message: "host rejected",
      properties: { structuredOutput: { code: 17 }, name: "ignored" },
    });
    expect(await run.result).toMatchObject({
      ok: true,
      value: ["host rejected", { code: 17 }, "Error"],
    });
    expect(
      await sandbox.execute(
        'image("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZuoAAAAASUVORK5CYII="); store("exit",true); exit(); throw Error("unreachable");',
      ),
    ).toMatchObject({
      ok: true,
      value: undefined,
      output: [{ type: "image", mimeType: "image/png" }],
      storeWrites: { set: { exit: true }, delete: [] },
    });
  } finally {
    await sandbox.close();
  }
});
it("real native QuickJS: performance clock advances relative to virtual start time", async () => {
  const sandbox = new ExpoCodemodeSandbox({ engine: new NativeEngine() });
  try {
    let answer!: (call: any) => void;
    const called = new Promise<any>((resolve) => (answer = resolve));
    const run = sandbox.start(
      "text(performance.now()); await tools.echo({}); return [performance.now(),performance.timeOrigin];",
      {
        startedAt: 1000,
        seed: 2,
        tools: [{ name: "echo" }],
        onCall: answer,
        timeoutMs: 2000,
      },
    );
    const call = await Promise.race([
      called,
      run.result.then((result) => {
        throw Error(JSON.stringify(result));
      }),
    ]);
    run.deliver(1, 1500, call.id, { ok: true, value: null });
    expect(await run.result).toMatchObject({
      ok: true,
      value: [500, 1000],
      output: [{ type: "text", text: "0" }],
    });
  } finally {
    await sandbox.close();
  }
});
it("real native QuickJS: memory/stack exhaustion stays within failed run", async () => {
  const sandbox = new ExpoCodemodeSandbox({
    engine: new NativeEngine(),
    limits: { memoryBytes: 2 * 1024 * 1024, stackBytes: 64 * 1024 },
  });
  try {
    const memory = await sandbox.execute(
      'const arrays=[]; while(true) arrays.push(new Array(10000).fill("bounded"));',
    );
    expect(memory.ok).toBe(false);
    const stack = await sandbox.execute(
      "function recurse(){return recurse()+1;} return recurse();",
    );
    expect(stack.ok).toBe(false);
    expect(await sandbox.execute("return 7;")).toMatchObject({
      ok: true,
      value: 7,
    });
  } finally {
    await sandbox.close();
  }
}, 10_000);
it("real native QuickJS: Date object coercion cannot reintroduce device timezone", async () => {
  const sandbox = new ExpoCodemodeSandbox({
    engine: new NativeEngine(undefined, "America/New_York"),
  });
  try {
    const result = await sandbox.start(
      `return [new Date(new String("2020-01-01T00:00:00")).toISOString(), new Date({[Symbol.toPrimitive](hint){if(hint!=="default")throw Error(hint);return "2020-01-01T00:00:00";}}).toISOString(), new Date(new Date(1234)).getTime()];`,
      { startedAt: 0, seed: 0, onCall() {} },
    ).result;
    expect(result).toMatchObject({
      ok: true,
      value: ["2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", 1234],
    });
  } finally {
    await sandbox.close();
  }
});
