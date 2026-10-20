import type {
  CodemodeSandboxBase as PiBase,
  CodemodeSandboxBaseOptions,
} from "@earendil-works/pi-codemode/portable";
import { CodemodeSandboxBase as VendoredBase } from "./vendor/pi/execution.js";
import type {
  CodemodeChannel,
  NativeLimits,
  QuickJSChannelEngine,
} from "./protocol.js";
import { effectiveLimits, nativeChannel } from "./native-channel.js";
// Same pinned implementation; the public type preserves nominal TS compatibility with Durable.
// Vendoring avoids portable's eager WASM launcher import. instanceof upstream Base is not supported.
const Base = VendoredBase as unknown as typeof PiBase;
export interface ExpoCodemodeSandboxOptions extends CodemodeSandboxBaseOptions {
  /** Pass createQuickJS() from expo-quickjs. This instance may be shared with other sandboxes. */
  engine?: QuickJSChannelEngine;
  /** Extra engine revision metadata. Legacy transports without identity must supply a full platform/build identity here. */
  engineRevision?: string;
  limits?: Partial<NativeLimits>;
  /** Advanced protocol transport seam; engine and channel are mutually exclusive. */
  channel?: CodemodeChannel;
}
export class ExpoCodemodeSandbox extends Base {
  private readonly stopFailures: unknown[];
  constructor({
    channel,
    engine,
    engineRevision,
    limits: partial,
    ...options
  }: ExpoCodemodeSandboxOptions) {
    const limits = effectiveLimits(partial);
    if (!!channel === !!engine)
      throw new Error("Provide exactly one native engine or channel");
    const transport = channel ?? nativeChannel(engine!, limits, engineRevision);
    const stopFailures: unknown[] = [];
    super(
      {
        timeoutMs: limits.timeoutMs,
        memoryLimitBytes: limits.memoryBytes,
        ...options,
      },
      async (data, events) => {
        const channel = await transport.start(data, events);
        return {
          post: (message) => channel.post(message),
          stop: async () => {
            try {
              await channel.stop();
            } catch (error) {
              stopFailures.push(error);
              throw error;
            }
          },
        };
      },
    );
    this.stopFailures = stopFailures;
  }
  override async close(): Promise<void> {
    await super.close();
    if (this.stopFailures.length)
      throw new AggregateError(this.stopFailures, "Native stop/join failed");
  }
}
