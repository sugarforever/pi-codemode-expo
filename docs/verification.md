# Adapter verification — 2026-10-20

Scope: standalone `pi-codemode-expo`, Pi Codemode/Durable 1.3.0, native QuickJS 2025-09-13 with expo-quickjs channel ABI 1. Host: macOS arm64, Node 26.8.1. No Moose changes, credentials, paid/model requests, publishing or remote creation.

## Evidence

| Check | Result | What it establishes |
| --- | --- | --- |
| `npm test` | 28 passing tests, 6 suites | Controlled protocol + actual C++ QuickJS + real Pi Harness/SQLite |
| `npm run typecheck` | Pass | Production and test TypeScript, including public Pi base compatibility |
| `npm run build` | Pass | Distributable ESM and declarations |
| `node scripts/check-package.mjs <native-tarball>` | Pass; generated report in `package-check.json` | Clean npm artifact installation, public native/Pi API compatibility, built runtime smoke and dependency/license checks |
| Independent code review | Three important findings fixed and regression tested | Virtual performance clock; stop/join failure propagation; object-valued UTC Date coercion |
| Native iOS adapter app | Pass, native session simulator evidence | Expo 58 / RN 0.88 Hermes; iOS 26.2 arm64 simulator; async tool/store and deterministic Date/performance/UTC smoke |
| Android adapter / mobile SQLite restart | Not run | No Android or native-mobile replay claim |

`tests/contract.test.ts`, `bootstrap.test.ts`, `native-channel.test.ts`, and `metro.test.ts` use controlled transports, including a Node VM double. Their 13 tests establish host/protocol behavior, not native isolation or resource enforcement.

`tests/native.test.ts` runs the **actual sibling C++ QuickJS runner**, with a child-process kill watchdog. Its 10 tests cover async tools/globals, Unicode JSON, store/helpers/image/exit, script and host errors, structured error properties, absent ambient capabilities, isolated runs, seeded randomness, virtual UTC Date/performance clocks, ordered delivery and exact started/idle/during semantics, concurrent Promise.all, CPU/microtask deadlines, abort during host wait, uncatchable output/pending-call budget failure, memory/stack exhaustion, and recovery with a fresh run.

`tests/durable-replay.test.ts` uses **real public Pi Durable Harness APIs and Node SQLite**, the native C++ engine, a persisted database closed/reopened between attempts, and controlled local tools. Its 5 tests establish:

- Successful writes commit; script failures and explicit task abort discard staged store writes.
- Completed nested results survive SQLite reopen without executing their tool again.
- Interrupted safe nested calls can rerun; interrupted unsafe nested calls do not rerun.
- A changed effective native limit changes the fingerprint and blocks new effects and store commits.

These are controlled close/reopen tests, not power-loss or hard-kill durability experiments, and not mobile SQLite evidence. They establish Pi-owned replay, not exactly-once external effects.

## Distribution and mobile limits

The clean artifact check installs both tarballs without sibling source links, compiles the actual `createQuickJS()` facade against `ExpoCodemodeSandbox` and `createCodemodeExtension`, imports built adapter JavaScript with WebAssembly unavailable, checks runtime imports for Node/Pi/WASM leakage, and checks MIT notices/provenance. It intentionally omits Expo peers; it is not an Expo native build. Native/SQLite tests additionally run against the installed adapter artifact.

The native-engine session separately owns Expo iOS/Android compilation and device actions. It built a clean packed Expo 58 / React Native 0.88 iOS Debug example, then installed the adapter artifact and exercised it on an iOS 26.2 arm64 simulator with Hermes. Its screen reports PASS for the generic calculation/Unicode async/timer responsiveness/CPU cancel/microtask cancel/output limit/ten disposals and the adapter tool-store/deterministic smoke. Adapter execute returned `{v:7}` after a delayed echo and store/load; deterministic start returned virtual Date 1000, performance 0, boxed local Date parsed as UTC, and no WeakRef. [Captured simulator evidence](evidence/ios-adapter.png).

The first simulator adapter attempt exposed Hermes function stringification returning bytecode; canonical bootstrap source is now frozen at package build time, and the corrected artifact passed the rerun. Android native build/device execution, native-mobile SQLite restart, and mobile reload/restart acceptance remain unverified. Example `App.tsx` and a real Harness-based `durable-scenario.ts` are provided for these checks.

A deterministic fingerprint includes the native engine/archive, platform/architecture/compiler identity when supplied by `engine.identity`, channel ABI, prelude/bootstrap hashes, deterministic policy and effective native budgets. An unidentified custom native transport is refused before deterministic admission unless the caller supplies a full build identity. Different platforms/builds intentionally do not share replay fingerprints. UTC locale formatting is stable UTC text rather than device-local formatting.

Native `limits.timeoutMs` is an independent finite wall-clock upper bound; Pi host deadlines may be shorter. A stop/join failure converts the execution to a sandbox failure and causes adapter `close()` to reject. Cancellation cannot undo host side effects already performed.


Pi Durable 1.3.0 itself eagerly imports the WASM-backed `portable` entry for only
`toCodemodeIdentifier`. The optional Metro helper redirects that one consumer to
the public `declarations` entry, which exports the same function without the VM.
This is a public-entry resolver adaptation, not a private runtime import or an
upstream package patch. The helper is separately exported for build configuration. Its routing is unit-tested, and the clean artifact check applies it to actual Pi Durable imports with WebAssembly unavailable and all transitive Node/WASM imports rejected. Pi Durable/typebox still need standard TextEncoder/TextDecoder; adapter-only runs do not.


Bootstrap source is generated at package build time and shipped as a string
literal. Metro/Babel/minifiers cannot inject outer helpers into VM code or change
its content fingerprint through host function stringification. Tests reject stale
generated source and verify runtime stringification changes do not alter bootstrap.
