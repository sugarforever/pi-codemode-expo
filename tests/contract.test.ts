import { describe, it, expect } from "vitest";
import { ExpoCodemodeSandbox } from "../src/index.js";

describe("Pi launcher contract (controlled transport)", () => {
  it("forwards a declared async tool and preserves output and store writes", async () => {
    const seen: unknown[] = [];
    const sandbox = new ExpoCodemodeSandbox({
      tools: [
        {
          name: "echo",
          execute: async (args) => {
            seen.push(args);
            return { answer: args };
          },
        },
      ],
      channel: {
        fingerprint: "test-engine",
        start: async (_data, events) => {
          queueMicrotask(() =>
            events.message({
              type: "call",
              id: 1,
              target: "tool",
              name: "echo",
              args: "42",
            }),
          );
          return {
            post(message) {
              expect(message).toEqual({
                type: "result",
                id: 1,
                ok: true,
                payload: '{"answer":42}',
              });
              events.message({
                type: "output",
                item: { type: "text", text: "hello" },
              });
              events.message({
                type: "done",
                ok: true,
                value: message.payload,
                writes: '[["saved","42"]]',
              });
            },
            stop: async () => {},
          };
        },
      },
    });
    expect(
      await sandbox.execute("unused by controlled transport"),
    ).toMatchObject({
      ok: true,
      value: { answer: 42 },
      output: [{ type: "text", text: "hello" }],
      storeWrites: { set: { saved: 42 }, delete: [] },
    });
    expect(seen).toEqual([42]);
    await sandbox.close();
  });
});
