// Compiled separately against both actual public packages by scripts/check-types.mjs.
import { createQuickJS, ENGINE_REVISION } from "expo-quickjs";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { ExpoCodemodeSandbox } from "pi-codemode-expo";
const engine = createQuickJS();
const sandbox = new ExpoCodemodeSandbox({
  engine,
  engineRevision: ENGINE_REVISION,
});
createCodemodeExtension({ sandbox });
void sandbox.close();
