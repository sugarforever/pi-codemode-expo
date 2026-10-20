import {
  Harness,
  createRegistry,
  defineTool,
  AssistantEntry,
  ToolTask,
  type Storage,
  type TaskId,
} from "@earendil-works/pi-durable";
import {
  createCodemodeExtension,
  CodemodeStoreDoc,
} from "@earendil-works/pi-durable/codemode";
import { createModels } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Type } from "typebox";
import {
  ExpoCodemodeSandbox,
  type QuickJSChannelEngine,
  type NativeLimits,
} from "pi-codemode-expo";

/** Supply the app's reopened Pi SQLite Storage. No provider/model request is performed. */
export async function openReplayScenario(
  storage: Storage,
  engine: QuickJSChannelEngine,
  options: {
    waitAtCheckpoint: boolean;
    replay: "safe" | "unsafe";
    limits?: Partial<NativeLimits>;
    onEffect: (name: "read" | "wait" | "after") => void;
  },
) {
  const sandbox = new ExpoCodemodeSandbox({ engine, limits: options.limits });
  const registry = createRegistry();
  registry.install(createCodemodeExtension({ sandbox, models: false }));
  registry.install({
    name: "controlled-replay",
    tools: [
      defineTool({
        name: "read",
        description: "Controlled JSON read",
        parameters: Type.Object({}),
        replay: "safe",
        async execute() {
          options.onEffect("read");
          return { output: [{ type: "text", text: "recorded-value" }] };
        },
      }),
      defineTool({
        name: "wait",
        description: "Controlled interruption point",
        parameters: Type.Object({}),
        replay: options.replay,
        async execute(_args, _api, ctx) {
          options.onEffect("wait");
          if (options.waitAtCheckpoint)
            await new Promise<void>((_resolve, reject) => {
              const signal = ctx.abortSignal!;
              if (signal.aborted) reject(signal.reason);
              else
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                });
            });
          return { output: [{ type: "text", text: "resumed-value" }] };
        },
      }),
      defineTool({
        name: "after",
        description: "Controlled new effect",
        parameters: Type.Object({}),
        replay: "unsafe",
        async execute() {
          options.onEffect("after");
          return { output: [{ type: "text", text: "after" }] };
        },
      }),
    ],
  });
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry },
    context,
  );
  const conversation = await harness.root(context);
  return {
    harness,
    async begin() {
      const id = await harness.commit(async (tx) => {
        const entry = await tx.appendEntry(AssistantEntry, conversation.id, {
          model: [
            {
              role: "assistant",
              api: "openai-responses",
              provider: "controlled",
              model: "no-network",
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
              content: [
                {
                  type: "toolCall",
                  id: "native-replay",
                  name: "codemode",
                  arguments: {
                    code: 'const value=await tools.read({}); store("pending",value); text(value); try { text(await tools.wait({})); } catch(error) { text("interrupted:"+error.message); } await tools.after({}); store("committed",true);',
                  },
                },
              ],
            },
          ],
        });
        return tx.createTask(
          ToolTask,
          { kind: "model", assistant: entry.id, callId: "native-replay" },
          {
            conversationId: conversation.id,
            ownership: { kind: "conversation" },
          },
        );
      }, context);
      harness.resume();
      return id;
    },
    async resume(id: TaskId) {
      return harness.waitForTask(id, context);
    },
    async store() {
      return harness.snapshot(CodemodeStoreDoc, conversation.id, context);
    },
    async close() {
      await sandbox.close();
      await harness.close(context);
    },
  };
}
