import type {
  CodemodeError,
  CodemodeSandboxBase as PiBase,
} from "@earendil-works/pi-codemode/portable";
/** Types extracted from the pinned public base constructor, without private runtime imports. */
export type VmLauncher = ConstructorParameters<typeof PiBase>[1];
export type VmStartData = Parameters<VmLauncher>[0];
export type VmEvents = Parameters<VmLauncher>[1];
export type VmChannel = Awaited<ReturnType<VmLauncher>>;
export type HostResult = Parameters<VmChannel["post"]>[0];
/** Advanced transport seam; tests using this are protocol tests, not engine tests. */
export interface CodemodeChannel {
  readonly fingerprint: string;
  start(data: VmStartData, events: VmEvents): VmChannel | Promise<VmChannel>;
}
export interface NativeLimits {
  timeoutMs: number;
  memoryBytes: number;
  stackBytes: number;
  outputBytes: number;
  messageBytes: number;
  maxHostCalls: number;
}
export const DEFAULT_LIMITS: Readonly<NativeLimits> = Object.freeze({
  timeoutMs: 10_000,
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 256 * 1024,
  outputBytes: 1024 * 1024,
  messageBytes: 1024 * 1024,
  maxHostCalls: 32,
});
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type NativeEvent = {
  runId: string;
  type: "message" | "terminal";
  status?:
    | "ok"
    | "script-error"
    | "timeout"
    | "aborted"
    | "resource-limit"
    | "native-error";
  json?: string;
  error?: string;
};
/** Structural subset of expo-quickjs's public facade. Never imports Expo in Node tests. */
export interface QuickJSChannelEngine {
  /** Native engine/archive, channel ABI, platform, architecture and compiler identity. */
  readonly identity?: string;
  start(
    options: {
      runId: string;
      bootstrap: string;
      data?: JsonValue;
      limits?: Partial<NativeLimits>;
    },
    onEvent: (event: NativeEvent) => void,
  ): Promise<void>;
  deliver(runId: string, message: JsonValue): Promise<void>;
  stop(runId: string): Promise<void>;
}
export function nativeError(event: NativeEvent): CodemodeError {
  return {
    kind:
      event.status === "timeout"
        ? "timeout"
        : event.status === "aborted"
          ? "aborted"
          : "sandbox",
    message: event.error ?? `Native QuickJS ${event.status}`,
  };
}
