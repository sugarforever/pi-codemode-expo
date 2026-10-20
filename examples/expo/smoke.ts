import {
  ExpoCodemodeSandbox,
  type QuickJSChannelEngine,
} from "pi-codemode-expo";

/** Caller supplies and owns createQuickJS(); closes only this sandbox. No network/model calls. */
export async function runAdapterSmoke(engine: QuickJSChannelEngine) {
  const sandbox = new ExpoCodemodeSandbox({
    engine,
    tools: [
      {
        name: "echo",
        async execute(args) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return args;
        },
      },
    ],
  });
  try {
    const execution = await sandbox.execute(
      'text("你好 🌲"); store("x",await tools.echo({v:7})); return load("x");',
    );
    if (!execution.ok || JSON.stringify(execution.value) !== '{"v":7}')
      throw Error(JSON.stringify(execution));
    const deterministic = await sandbox.start(
      'return [Date.now(),performance.now(),Math.random(),new Date(new String("2020-01-01T00:00:00")).toISOString(),typeof WeakRef];',
      {
        startedAt: 1000,
        seed: 42,
        onCall() {
          throw Error("Unexpected host call");
        },
      },
    ).result;
    if (!deterministic.ok) throw Error(JSON.stringify(deterministic));
    const value = deterministic.value as unknown[];
    if (
      value[0] !== 1000 ||
      value[1] !== 0 ||
      value[3] !== "2020-01-01T00:00:00.000Z" ||
      value[4] !== "undefined"
    )
      throw Error(JSON.stringify(deterministic));
    return {
      passed: true,
      identity: engine.identity,
      execution,
      deterministic,
    };
  } finally {
    await sandbox.close();
  }
}
