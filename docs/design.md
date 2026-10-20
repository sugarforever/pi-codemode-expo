# Reusable Expo QuickJS execution library

Status: adapter implemented locally in standalone pi-codemode-expo, 2026-10-20. Native engine lives in sibling expo-quickjs. iOS adapter smoke passes; Android/mobile SQLite acceptance remains unverified. No execution capability has been added to Moose.

## Goal and distribution

Build our own MIT-licensed native QuickJS library for Expo on iOS and Android. Keep Hermes as the app runtime. Start in a new standalone sibling repository, `expo-quickjs`, with two publishable packages: `expo-quickjs` and `pi-codemode-expo`. Names are provisional until npm availability is checked. Do not publish or create a remote repository as part of local implementation.

The core package has no Pi, Moose, filesystem, network, SQLite, or credential dependencies. The adapter targets Moose's installed Pi Codemode/Durable 1.3.0. Moose integration is a later consumer change, after both packages pass their acceptance checks.

## Native core

Compile pinned QuickJS C source into the app, without WASM or JIT. Include source provenance, checksum, license, and reproducible update instructions; do not fetch an unpinned engine during pod install. Use one shared C++ execution core with Swift/Objective-C++ and Kotlin/JNI platform bindings through Expo Modules. Start compatibility verification with Expo 58 and React Native 0.88.

Each run owns a fresh runtime/context and a dedicated native worker thread. Creation, evaluation, promise jobs, result delivery and destruction all run on that thread. Hermes only sends and receives bounded JSON messages. Never invoke a Hermes JSI callback from the QuickJS thread. Dispose on the owning thread, once, including on module destruction.

Expose `execute(code, options): Promise<ExecutionResult>`, `cancel(runId): Promise<void>`, and `close(): Promise<void>`. `options` includes an explicit run ID, tools, AbortSignal, timeout and memory/output budgets. Host handlers receive parsed JSON and a cancellation signal. Scripts use `await tools.<name>(args)` and `text(value)`; no implicit host globals, module loading, filesystem, networking, shell or Node APIs. Results distinguish script, timeout, aborted, resource-limit and native-transport errors. Host calls have unique IDs; duplicate, unknown, stale and oversized replies are rejected without reentering a running VM.

Initial defaults: 10-second deadline, 32 MiB QuickJS allocator limit, 256 KiB QuickJS stack limit, 1 MiB aggregate output, 1 MiB per bridge message, 32 concurrent host calls and two live executions per module. These are tested bounds, not claims about total process RSS. Validate UTF-8 byte sizes, positive finite integer limits, and unique tool names/run IDs before admission.

Interrupt running bytecode through an atomic cancellation/deadline flag and QuickJS interrupt handler. Check between bounded promise-job batches as well, including `while (true) await null`. A cancel request must not queue behind evaluation. Enforce the deadline using a native monotonic clock. Bound serialization and document operations that may delay interrupt polling. Withhold failed-run store writes; cancellation cannot undo external host side effects.

Separate runtimes are an in-process capability boundary, not OS isolation or a guarantee against native engine vulnerabilities. No background execution guarantee beyond the mobile OS lifecycle.

## Pi adapter

Implement Pi's native VM launcher/message contract behind `CodemodeSandboxBase`, including ordinary execute and deterministic start/deliver/stop. Preserve Pi helpers, errors, store/load, tool IDs, output ordering, started/idle messages and ordered result delivery. Pin/vend required MIT-licensed prelude/protocol code with provenance instead of importing unexported package paths. Prefer upstreaming a public backend interface later.

Deterministic runs use UTC, a virtual clock and seeded randomness; disable nondeterministic weak-reference APIs. Fingerprints include engine revision, native backend/protocol version, prelude hash, deterministic settings and effective limits. Native and WASM fingerprints differ. Pi Durable owns persistence, replay and nested task execution; the adapter does not create a second journal. Replay mismatch must fail before new host side effects.

## Acceptance

- Real native-engine tests: calculations, Unicode/JSON, async host calls, Promise.all, script/host errors, isolation, no ambient capabilities, memory/stack/output exhaustion and repeated create/destroy.
- CPU loop and microtask loop cancellation/deadline tests run in a subprocess with an external kill watchdog so regressions cannot hang CI.
- Concurrent result delivery, duplicate/stale replies, cancellation during host waits, cancel before admission, close while executing and reload cleanup settle exactly once and release resources.
- Real Pi Durable/SQLite tests replay a partially completed script after reopen, preserve recorded results, reject fingerprint divergence and honor nested tool replay policy. Do not claim exactly-once arbitrary effects.
- An Expo example imports packed npm artifacts, calls a delayed controlled host tool, remains responsive during CPU work, cancels both loop types and survives reload on iOS and Android.
- Report host native tests, TypeScript checks, package checks, native builds and simulator/device actions separately. No real model credentials or paid requests are required.

## Tradeoffs

Native QuickJS avoids a mobile WASM host but loses WASM's extra memory boundary and requires native builds. A dedicated thread per admitted run simplifies ownership; the two-run admission bound limits thread growth. The minimal core supports general agent tools without coupling it to FPL. Loading skill resources and providing HTTP/SQLite tools remain separate Moose features.
