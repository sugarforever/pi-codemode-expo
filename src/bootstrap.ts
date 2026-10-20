import { PRELUDE_SOURCE } from "./vendor/pi/prelude-source.js";
import { BOOTSTRAP_RUNTIME_SOURCE } from "./bootstrap-runtime-source.js";
import type { NativeLimits } from "./protocol.js";
/** Non-cryptographic content identity, matching Pi's FNV-1a convention. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return (value >>> 0).toString(16).padStart(8, "0");
}
export function fingerprint(engine: string, limits: NativeLimits): string {
  return `${engine}; expo-quickjs-channel-1; pi-codemode 1.3.0; prelude ${hash(PRELUDE_SOURCE)}; bootstrap ${hash(BOOTSTRAP_RUNTIME_SOURCE)}; deterministic 1 UTC mulberry32 weakrefs-off ordered-drain; limits ${JSON.stringify(limits)}`;
}
export function createBootstrap(engine: string, limits: NativeLimits): string {
  return `(${BOOTSTRAP_RUNTIME_SOURCE})(${PRELUDE_SOURCE},${JSON.stringify(fingerprint(engine, limits))});`;
}
