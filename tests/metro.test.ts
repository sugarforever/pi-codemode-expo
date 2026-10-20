import { it, expect } from "vitest";
import { withPiCodemodeExpo } from "../src/metro.js";
it("uses Pi public declarations for Durable identifier import without its eager WASM launcher", () => {
  const calls: unknown[] = [];
  const fallback = (context: any, name: string, platform: string) => {
    calls.push([context.originModulePath, name, platform]);
    return { filePath: name };
  };
  const original = { resolver: { resolveRequest: fallback } };
  const config = withPiCodemodeExpo(original);
  const resolve = config.resolver.resolveRequest;
  expect(
    resolve(
      {
        originModulePath:
          "/node_modules/@earendil-works/pi-durable/dist/codemode/codemode.js",
        resolveRequest: fallback,
      },
      "@earendil-works/pi-codemode/portable",
      "ios",
    ),
  ).toEqual({ filePath: "@earendil-works/pi-codemode/declarations" });
  expect(
    resolve(
      { originModulePath: "/app/other.js", resolveRequest: fallback },
      "@earendil-works/pi-codemode/portable",
      "android",
    ),
  ).toEqual({ filePath: "@earendil-works/pi-codemode/portable" });
  expect(original.resolver.resolveRequest).toBe(fallback);
  expect(calls).toHaveLength(2);
});
