import { test } from "node:test";
import assert from "node:assert/strict";
import { HostNativeTransport } from "./native-transport.ts";
test("closing after a native terminal event tolerates the pipe closing before exit", async () => {
  const transport = new HostNativeTransport();
  let terminal;
  const received = new Promise((resolve) => (terminal = resolve));
  transport.addListener("onEvent", (event) => {
    if (event.type === "terminal") terminal(event);
  });
  await transport.start(
    "race",
    'globalThis.__receive=()=>{};globalThis.__drain=()=>false;__finish("7");',
    "null",
    '{"timeoutMs":1000,"memoryBytes":33554432,"stackBytes":262144,"outputBytes":1048576,"messageBytes":1048576,"maxHostCalls":32}',
  );
  const child = transport.children.get("race");
  await received;
  assert.doesNotThrow(() =>
    child.stdin.emit(
      "error",
      Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    ),
  );
  await transport.close();
});
