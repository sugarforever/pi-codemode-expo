import { createBootstrap } from "./bootstrap.js";
import {
  DEFAULT_LIMITS,
  nativeError,
  type CodemodeChannel,
  type NativeLimits,
  type QuickJSChannelEngine,
} from "./protocol.js";
let nextRunId = 0;
export const ENGINE_REVISION = "quickjs-2025-09-13";
export const CHANNEL_VERSION = "expo-quickjs-channel-1";
export function effectiveLimits(
  partial: Partial<NativeLimits> = {},
): NativeLimits {
  const limits = { ...DEFAULT_LIMITS, ...partial };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${key} must be a positive safe integer`);
  return limits;
}
export function nativeChannel(
  engine: QuickJSChannelEngine,
  limits: NativeLimits,
  engineRevision?: string,
): CodemodeChannel {
  const identity = engine.identity?.trim();
  const fullIdentity = identity
    ? `${identity}; adapter revision ${engineRevision ?? ENGINE_REVISION}`
    : engineRevision?.trim();
  return {
    fingerprint: fullIdentity ?? `${ENGINE_REVISION}; identity unreported`,
    async start(data, events) {
      if (data.deterministic && !fullIdentity) {
        throw new Error(
          "Deterministic runs require a native build identity or an explicit full engineRevision",
        );
      }
      const runId = `pi-codemode-${++nextRunId}`;
      const effective = effectiveLimits({
        ...limits,
        ...(data.memoryLimitBytes === undefined
          ? {}
          : { memoryBytes: data.memoryLimitBytes }),
      });
      let stopped = false;
      let stopPromise: Promise<void> | undefined;
      const stop = () =>
        (stopPromise ??= (async () => {
          stopped = true;
          await engine.stop(runId);
        })());
      const fail = (error: unknown) => {
        if (!stopped)
          events.failure({
            kind: "sandbox",
            message: error instanceof Error ? error.message : String(error),
          });
      };
      await engine.start(
        {
          runId,
          bootstrap: createBootstrap(
            fullIdentity ?? `${ENGINE_REVISION}; identity unreported`,
            effective,
          ),
          data: JSON.parse(JSON.stringify(data)),
          limits: effective,
        },
        (event) => {
          if (stopped || event.runId !== runId) return;
          try {
            if (event.type === "message") {
              if (typeof event.json !== "string")
                throw new Error("Native message has no JSON payload");
              events.message(JSON.parse(event.json));
            } else if (event.status === "ok" && event.json !== undefined)
              events.message(JSON.parse(event.json));
            else events.failure(nativeError(event));
          } catch (error) {
            fail(error);
          }
        },
      );
      return {
        post(message) {
          if (!stopped)
            void engine
              .deliver(runId, JSON.parse(JSON.stringify(message)))
              .catch(fail);
        },
        stop,
      };
    },
  };
}
