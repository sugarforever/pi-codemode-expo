# Expo QuickJS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver independently reusable native Expo QuickJS and Pi Codemode adapter packages.

**Architecture:** A shared C++ worker owns each QuickJS runtime, with Expo platform bindings carrying bounded JSON messages to Hermes. A separate TypeScript adapter implements Pi's sandbox contract. Moose becomes a consumer after package acceptance.

**Tech Stack:** Pinned QuickJS C, C++17, Expo Modules, Swift/Objective-C++, Kotlin/JNI, TypeScript, CMake/CTest, Vitest, real Pi Durable and SQLite.

**Spec:** ../../expo-quickjs-design.md

## Global Constraints

- Separate sibling repository `expo-quickjs`; no npm publication or remote repository creation.
- MIT license with engine and reused Pi source notices; no code from the candidate wrappers.
- Expo 58 / React Native 0.88 initial verification; native iOS and Android, Hermes retained.
- Defaults: 10 s, 32 MiB VM allocator, 256 KiB VM stack, 1 MiB output/message, 32 host calls, two runs.
- Keep Moose runtime, credentials and existing untracked research untouched during library development.
- Tests precede implementation; native checks use the real engine, not a Node eval substitute.

## Review Focus

- Bytecode and microtask loops must both terminate without blocking Hermes.
- Cancellation and teardown racing with host results must settle once without use-after-free.
- UTF-8 and cyclic/oversized values must obey byte bounds and return explicit errors.
- Native replay must reject changed fingerprints before new host effects.
- Packed packages must build in an Expo consumer without sibling source dependencies.

---

### Task 1: Native core with controlled execution

**Files:** Create `packages/expo-quickjs/cpp/{Runtime,Execution,Protocol}.{h,cpp}`, `native-tests/execution_test.cpp`, root `CMakeLists.txt`, engine vendor/provenance files and package licenses in the new repository.

**Interfaces:** Produces native `Execution` with start, deliver, cancel and close, plus JSON call/output/terminal events; one owner thread per run.

- [ ] Select and checksum an upstream engine revision; establish CTest runner and an out-of-process watchdog.
- [ ] Add failing behavior tests for return values, isolation, missing ambient APIs, Unicode byte bounds, memory/stack exhaustion, CPU and microtask deadlines and cancellation before/after start. Confirm expected failures.
- [ ] Implement the shared runtime owner, validated limits, interrupt flag, bounded job pump and terminal cleanup.
- [ ] Add failing async bridge tests: concurrent calls resolved out of order, rejection, stale/duplicate IDs, output flooding and cancellation while waiting. Implement result delivery and bounded admission.
- [ ] Run `cmake -S . -B build`, `cmake --build build`, and `ctest --test-dir build --output-on-failure`; run supported address/thread sanitizer configurations. Require watchdog-bounded completion and no reported lifetime errors.

### Task 2: Expo bindings and public API

**Files:** Create `packages/expo-quickjs/{src,ios,android}`, `expo-module.config.json`, podspec, package/build config, `tests/expo-bridge.test.ts` and `apps/example`.

**Interfaces:** Consumes native execution/events; exports `execute(code, options): Promise<ExecutionResult>`, `cancel(runId): Promise<void>`, and `close(): Promise<void>` with documented TypeScript types.

- [ ] Add failing TypeScript transport tests for validated options, tool dispatch, host errors, AbortSignal, oversize/cyclic JSON, duplicate IDs, late results and teardown. Test actual facade behavior with a controlled transport; engine behavior remains covered natively.
- [ ] Implement Swift/Objective-C++ and Kotlin/JNI bindings; all VM entry points stay on the owning thread. Post host events to Hermes through supported Expo APIs.
- [ ] Implement the facade, listener cleanup, concurrency caps and native teardown. Add example controls for evaluate, async host call, loops, limits and cancel.
- [ ] Run TypeScript build/tests and native core suite. Build and exercise the example on iOS and Android; verify responsiveness, repeated cancellation, reload cleanup and absence of runtime cross-thread access. Record unavailable platforms explicitly.

### Task 3: Pi Codemode and Durable compatibility

**Files:** Create `packages/pi-codemode-expo/src/{sandbox,protocol,prelude}.ts`, package notices, `tests/{codemode,durable-replay}.test.ts`, and native example replay scenarios.

**Interfaces:** Consumes the native channel; exports `ExpoCodemodeSandbox` compatible with Pi 1.3.0 `CodemodeSandboxBase` and `createCodemodeExtension({ sandbox })`.

- [x] Add failing contract tests for Pi helpers/store, started/idle call counts, virtual clock, seeded randomness, UTC, ordered results and fingerprint mismatch. Include real native tests for deterministic semantics, not only transport doubles.
- [x] Implement launcher, pinned protocol/prelude adaptation and a native-specific fingerprint. Avoid private package imports and Node/WASM dependencies in the mobile graph.
- [x] Add failing real Harness/SQLite restart tests: committed nested result replay, interrupted non-safe effects, successful store commit, aborted store rejection and divergent replay blocked before new calls. Implement only missing adapter behavior; reuse Pi's journal.
- [ ] Run the complete library test suite and repeat replay scenarios in the native Expo example on both platforms.

### Task 4: Distribution and consumer verification

**Files:** Create root/package READMEs, example setup docs, CI workflows and package packing checks.

**Interfaces:** Produces independently installable npm tarballs; does not publish them or enable script execution in Moose.

- [ ] Pack both packages and install them into a clean Expo consumer; verify compiled native source, typings, notices and relative dependencies resolve without repository-only files.
- [ ] Run the complete test/type/native build matrix against the packed artifacts. Use a controlled JSON mapping/import host tool to demonstrate an FPL-shaped workflow without a real model request.
- [ ] Document capability limits, cancellation semantics, replay compatibility, build requirements and verified platforms. Review final diff against every acceptance item and report remaining gaps honestly.

## Execution recommendation

Native execution in this session is appropriate: tasks depend closely on one engine ownership and protocol contract. Review this plan and design before implementation as required by the writing-plans skill. No delegation or remote publication has been authorized.


## Standalone adapter execution record (2026-10-20)

Task 3 implementation lives at the root of `pi-codemode-expo`, not a monorepo
package directory. Task 1/2 and native engine distribution remain owned by the
separate `expo-quickjs` chat/repository. No Moose source or native source changed
in this adapter session. No remote or publication was created.

Task 3 host checks and adapter distribution are implemented. The remaining
unchecked Android, mobile SQLite replay, and reload acceptance items are not claimed complete. iOS adapter smoke passed in the native session.
See `verification.md` for exact evidence and limitations.
