# pi-codemode-expo

MIT native Expo QuickJS adapter for **Pi Codemode / Pi Durable 1.3.0**. Hermes stays the application runtime; scripts run on dedicated native QuickJS workers through `expo-quickjs`. No WASM or Node imports occur in this package's mobile runtime graph.

Experimental 0.1.0 implementation; source is hosted on GitHub. npm publication is release-driven and requires the native peer first. Native host conformance and real SQLite restart tests pass. An actual iOS Hermes simulator smoke passes for tools/store and deterministic start. Android execution and native-mobile SQLite replay remain unverified. See [verification](docs/verification.md).

## Install and use

Install packed `expo-quickjs` and `pi-codemode-expo` artifacts alongside `@earendil-works/pi-codemode@1.3.0`. `expo-quickjs` requires an Expo development/native build, not Expo Go. Initial target: Expo 58, React Native 0.88, Hermes. Follow the native package's platform setup.

```ts
import { createQuickJS, ENGINE_REVISION } from 'expo-quickjs';
import { ExpoCodemodeSandbox } from 'pi-codemode-expo';

const engine = createQuickJS();
const sandbox = new ExpoCodemodeSandbox({
  engine,
  engineRevision: ENGINE_REVISION,
  tools: [{ name: 'lookup', execute: async (args) => ({ ...(args as { id: number }), points: 7 }) }],
});
const result = await sandbox.execute(`
  const player = await tools.lookup({ id: 42 });
  text(player);
  store('player', player);
  return player.points;
`);
await sandbox.close();
await engine.close(); // The engine owner closes it, after all shared sandboxes.
```

Tool arguments/results cross a bounded JSON channel. Tools receive an AbortSignal. Scripts have `tools`, `ALL_TOOLS`, `text`, `image`, `console`, `exit`, `store`, `load`, and explicitly declared async globals. No implicit filesystem, network, shell, credentials, timers, modules, or Node APIs. `storeWrites` are returned only on success; ordinary execute does not persist them.

## Pi Durable

```ts
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode';
registry.install(createCodemodeExtension({ sandbox, models: false }));
```

Pi Durable 1.3.0's identifier import otherwise eagerly includes its WASM launcher. Configure Metro with the supplied helper (Node 22.19+):

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withPiCodemodeExpo } = require('pi-codemode-expo/metro');
module.exports = withPiCodemodeExpo(getDefaultConfig(__dirname));
```

This redirects only Pi Durable's `portable` identifier import to Pi's public `declarations` entry, which exports the same identifier function without a VM launcher. It composes an existing resolver and leaves other imports unchanged. Do not import the Metro helper from application code. Pi Durable/typebox also require standard `TextEncoder`/`TextDecoder`; the app must provide these APIs if its runtime does not.

Pi Durable owns all journals, SQLite storage, nested tasks, replay policy and store commits. This package adds no persistence layer. `start(code, options)` / `run.deliver(seq, now, id, outcome)` use the Pi 1.3.0 public contract. Deterministic runs use virtual UTC time, mulberry32 seeded randomness, no weak references, ordered result application, and `started`/`idle` call counts. Date locale formatting uses stable UTC strings instead of device locale formatting. Each script gets a fresh runtime.

The fingerprint covers native build/platform/architecture/compiler identity (`engine.identity`), channel ABI, pinned Pi/prelude identity, bootstrap identity, deterministic settings, and effective native budgets. Custom transports without identity must supply a full `engineRevision` build identity for deterministic start; unidentified runs fail before admission. Different native platforms/builds intentionally have different fingerprints. Native/WASM fingerprints differ; an in-flight WASM run cannot migrate to native. Pi checks fingerprints and recorded call counts before admitting new replay effects. Completed nested results are reused; interrupted safe tools can rerun, and interrupted unsafe tools are not rerun. This does **not** guarantee exactly-once arbitrary external effects. Cancellation cannot undo effects already performed by host tools.

The host implementation and prelude are vendored from MIT Pi 1.3.0 because the public `portable` runtime entry also imports its WASM launcher. Public Pi types are used without private runtime deep imports. The adapter is accepted by `createCodemodeExtension({ sandbox })`; `sandbox instanceof` the upstream runtime `CodemodeSandboxBase` is not supported. See [NOTICE](NOTICE) and [provenance](vendor/pi/provenance.json).

## Budgets and lifecycle

Defaults: 10 seconds native monotonic deadline, 32 MiB VM allocator, 256 KiB stack, 1 MiB aggregate bridge output, 1 MiB per message, 32 pending host calls; native module admission is two live executions. Output accounting conservatively includes protocol messages and terminal values, not just visible text. These limits do not cap total app RSS.

```ts
const sandbox = new ExpoCodemodeSandbox({
  engine,
  limits: { timeoutMs: 10_000, outputBytes: 512 * 1024 },
  memoryLimitBytes: 32 * 1024 * 1024,
});
```

`memoryLimitBytes` overrides `limits.memoryBytes`. Pi's `timeoutMs`/execute override controls the host deadline; the independent native `limits.timeoutMs` remains a hard upper bound, including for deterministic runs where Pi otherwise defaults to no deadline. `Infinity` only disables Pi's host deadline. Native limits remain finite and are fingerprinted. Larger native timeouts must be configured through `limits` as well.

The first terminal outcome wins. `close()` aborts active tools and waits for pending native admission, worker stop and join. Stop/join failure surfaces as a sandbox error and rejects `close()`. It rejects new runs, but does not close a shared engine. Native interruption covers bytecode and pending-job loops. Some built-ins/serialization may delay interrupt polling. Background execution is subject to the mobile OS. An in-process native VM is a capability boundary, not OS isolation or protection from native engine vulnerabilities.

## Development and verification

```sh
npm ci
npm run test:protocol
npm run typecheck
npm run build
# Build expo-quickjs in its sibling repo first, or point at its channel_runner:
EXPO_QUICKJS_RUNNER=/absolute/path/to/channel_runner npm test
npm pack
node scripts/check-package.mjs /absolute/path/to/expo-quickjs-0.1.0.tgz
```

`npm test` includes real native C++ QuickJS and Pi Durable/SQLite tests and requires the native runner. Protocol tests use controlled transports and a Node VM double; they do not establish native engine behavior. Native loop tests use child processes with an external kill watchdog. The sibling repository is read by tests only; packed consumers need no sibling source. See [Expo example](examples/expo/README.md) and [channel contract](docs/native-channel.md).


## Releases

GitHub Actions runs native QuickJS, adapter, SQLite restart, and packed-consumer
checks against a pinned `sugarforever/expo-quickjs` commit. A published GitHub
release triggers `.github/workflows/publish.yml`; its tag must equal
`v<package.json version>`. GitHub prereleases and semver prereleases publish to
npm's `next` channel; ordinary releases publish to `latest`. No publication occurs
on a normal push.

This is ready for an **experimental/iOS-validated release**, not a claim of full
Android/mobile SQLite acceptance. Publish `expo-quickjs@0.1.0` first; the adapter
workflow checks that it exists on npm. For the initial release, use a GitHub
prerelease named `v0.1.0` after the prerequisites below are configured.

Configure npm trusted publishing for package `pi-codemode-expo`: GitHub owner
`sugarforever`, repository `pi-codemode-expo`, workflow filename `publish.yml`,
environment `npm`, and allow publishing. The workflow uses OIDC and provenance.
If npm requires an authenticated first publication before trusted-publisher setup,
set a package-scoped granular `NPM_TOKEN` repository secret for that first run;
remove it after trusted publishing is configured. Do not commit tokens.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
for the account-side setup. Package version changes must be committed before
creating the matching GitHub release. The `npm` GitHub environment can have
maintainer-configured release protection rules.
