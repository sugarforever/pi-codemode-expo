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

it("routes explicitly configured workspace Durable roots with path boundaries", () => {
  const resolve = withPiCodemodeExpo({}, {
    durableRoots: ["/workspace/pi-durable/", "C:\\workspace\\pi-durable\\"],
  }).resolver.resolveRequest;
  const portable = "@earendil-works/pi-codemode/portable";
  const declarations = "@earendil-works/pi-codemode/declarations";
  for (const [origin, name, expected] of [
    ["/workspace/pi-durable/dist/codemode.js", portable, declarations],
    ["C:\\workspace\\pi-durable\\dist\\codemode.js", portable, declarations],
    ["/workspace/pi-durable-extra/index.js", portable, portable],
    ["/workspace/other/index.js", portable, portable],
    ["/workspace/pi-durable/dist/index.js", "other-package", "other-package"],
  ]) {
    expect(resolve({ originModulePath: origin, resolveRequest: (_: unknown, requested: string) => requested }, name, "ios")).toBe(expected);
  }
});

it("rejects empty, filesystem-root and relative workspace package directories", () => {
  for (const root of ["", "/", "C:\\", "../pi-durable"]) {
    expect(() => withPiCodemodeExpo({}, { durableRoots: [root] })).toThrow(/absolute package directory/);
  }
});
