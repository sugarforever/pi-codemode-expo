/**
 * Pi Durable 1.3.0 needs only toCodemodeIdentifier from portable, whose eager
 * reexports otherwise pull its WASM launcher into Metro. The public declarations
 * entry exports that exact function without importing a VM backend.
 * Development/build configuration only; do not import this from the mobile app.
 */
export interface PiCodemodeExpoMetroOptions {
  /** Absolute package directories for workspace/symlinked copies of Pi Durable 1.3.0. */
  durableRoots?: readonly string[];
}
export function withPiCodemodeExpo<T extends { resolver?: any }>(
  config: T,
  options: PiCodemodeExpoMetroOptions = {},
): T & { resolver: { resolveRequest: (context: any, moduleName: string, platform: string | null) => any } } {
  const roots = (options.durableRoots ?? []).map((root) => {
    const normalized = root.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!/^(?:\/[^/]|[A-Za-z]:\/[^/]|\/\/[^/]+\/[^/]+\/[^/])/.test(normalized))
      throw new Error("durableRoots must contain an absolute package directory");
    return normalized + "/";
  });
  const previous = config.resolver?.resolveRequest;
  return {
    ...config,
    resolver: {
      ...config.resolver,
      resolveRequest(
        context: any,
        moduleName: string,
        platform: string | null,
      ) {
        const origin = String(context.originModulePath ?? "").replaceAll(
          "\\",
          "/",
        );
        const name =
          moduleName === "@earendil-works/pi-codemode/portable" &&
          (/(?:^|\/)@earendil-works\/pi-durable\//.test(origin) ||
            roots.some((root) => origin.startsWith(root)))
            ? "@earendil-works/pi-codemode/declarations"
            : moduleName;
        return (previous ?? context.resolveRequest)(context, name, platform);
      },
    },
  };
}
