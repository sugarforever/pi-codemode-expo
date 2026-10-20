/**
 * Pi Durable 1.3.0 needs only toCodemodeIdentifier from portable, whose eager
 * reexports otherwise pull its WASM launcher into Metro. The public declarations
 * entry exports that exact function without importing a VM backend.
 * Development/build configuration only; do not import this from the mobile app.
 */
export function withPiCodemodeExpo<T extends { resolver?: any }>(config: T): T {
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
          /(?:^|\/)@earendil-works\/pi-durable\//.test(origin)
            ? "@earendil-works/pi-codemode/declarations"
            : moduleName;
        return (previous ?? context.resolveRequest)(context, name, platform);
      },
    },
  };
}
