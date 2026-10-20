import { describe, it, expect } from "vitest";
import { createContext, runInContext, constants } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { createBootstrap, fingerprint } from "../src/bootstrap.js";
import { DEFAULT_LIMITS } from "../src/protocol.js";

// Executes the actual bootstrap in Node's vm solely as a protocol double.
// This does NOT establish native QuickJS semantics, resource limits or isolation.
async function boot(code: string, deterministic: boolean = true) {
  const messages: any[] = [];
  let done: any;
  const data = {
    code,
    tools: [{ name: "echo", jsName: "echo", description: "Echo" }],
    globals: [{ name: "helper", spread: true }],
    store: { saved: "42" },
    deterministic: deterministic
      ? { startedAt: 1700000000000, seed: 42 }
      : undefined,
  };
  const context = createContext(constants.DONT_CONTEXTIFY);
  Object.assign(context, {
    __startData: data,
    __emit: (json: string) => messages.push(JSON.parse(json)),
    __request: (_id: number, json: string) => messages.push(JSON.parse(json)),
    __finish: (json: string) => {
      done = JSON.parse(json);
    },
  });
  runInContext("delete globalThis.console", context);
  runInContext(createBootstrap("engine-a", DEFAULT_LIMITS), context);
  const receive = runInContext("__receive", context);
  const drain = runInContext("__drain", context);
  runInContext(
    "delete globalThis.__receive; delete globalThis.__drain",
    context,
  );
  const pump = async () => {
    for (let i = 0; i < 8; i++) {
      await setImmediate();
      const again = drain();
      if (!again) {
        await setImmediate();
        drain();
        break;
      }
    }
  };
  await pump();
  return {
    messages,
    get done() {
      return done;
    },
    async deliver(message: any) {
      receive(message);
      await pump();
    },
  };
}

describe("bootstrap in controlled JS protocol double", () => {
  it("hides bridge globals before script and preserves helpers/store", async () => {
    const vm = await boot(
      'text(load("saved")); store("next", 7); return [typeof __request, typeof __receive, ALL_TOOLS[0].name, await helper(1,2)];',
    );
    expect(vm.messages[0]).toMatchObject({ type: "started" });
    expect(vm.messages.find((m) => m.type === "call")).toMatchObject({
      id: 1,
      target: "global",
      name: "helper",
      args: "[1,2]",
    });
    await vm.deliver({
      type: "result",
      id: 1,
      ok: true,
      payload: "3",
      seq: 1,
      now: 1700000000100,
    });
    expect(vm.done).toMatchObject({
      type: "done",
      ok: true,
      value: '["undefined","undefined","echo",3]',
      writes: '[["next","7"]]',
      during: { seq: 1, issued: 1 },
    });
  });
  it("applies out-of-order results at distinct drains with monotonic virtual UTC clock", async () => {
    const vm = await boot(
      "const a=tools.echo(1).then(()=>text(Date.now())); const b=tools.echo(2).then(()=>text(Date.now())); await Promise.all([a,b]); return [new Date().getTimezoneOffset(),new Date(2020,0,1).toISOString(),typeof WeakRef,typeof FinalizationRegistry];",
    );
    await vm.deliver({
      type: "result",
      id: 2,
      ok: true,
      payload: "2",
      seq: 2,
      now: 1700000000090,
    });
    expect(vm.messages.filter((m) => m.type === "output")).toHaveLength(0);
    await vm.deliver({
      type: "result",
      id: 1,
      ok: true,
      payload: "1",
      seq: 1,
      now: 1700000000100,
    });
    expect(
      vm.messages.filter((m) => m.type === "output").map((m) => m.item.text),
    ).toEqual(["1700000000100", "1700000000100"]);
    expect(vm.messages.filter((m) => m.type === "idle")).toEqual([
      { type: "idle", seq: 0, issued: 2 },
      { type: "idle", seq: 1, issued: 2 },
    ]);
    expect(JSON.parse(vm.done.value)).toEqual([
      0,
      "2020-01-01T00:00:00.000Z",
      "undefined",
      "undefined",
    ]);
  });
  it("reproduces seeded randomness and reports stalled script errors", async () => {
    const a = await boot("return [Math.random(), Math.random(),Date()];");
    const b = await boot("return [Math.random(), Math.random(),Date()];");
    expect(a.done.value).toBe(b.done.value);
    const stuck = await boot("await new Promise(()=>{});");
    expect(stuck.done.ok).toBe(false);
    expect(JSON.parse(stuck.done.error).message).toContain("never settle");
  });
  it("includes engine, prelude, bootstrap and limits in fingerprint", () => {
    const a = fingerprint("native-a", DEFAULT_LIMITS);
    expect(a).toContain("native-a");
    expect(a).not.toBe(fingerprint("native-b", DEFAULT_LIMITS));
    expect(a).not.toBe(
      fingerprint("native-a", { ...DEFAULT_LIMITS, outputBytes: 22 }),
    );
    expect(a).toContain("prelude");
    expect(a).toContain("bootstrap");
  });
});
it("bootstrap source survives host function stringification changes", () => {
  const before = createBootstrap("native-build", DEFAULT_LIMITS);
  const original = Function.prototype.toString;
  let after: string;
  try {
    Function.prototype.toString = () =>
      "function transformed(){ externalBundlerHelper(); }";
    after = createBootstrap("native-build", DEFAULT_LIMITS);
  } finally {
    Function.prototype.toString = original;
  }
  expect(after!).toBe(before);
});
