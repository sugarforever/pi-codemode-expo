# Packed Expo consumer

Use a native Expo 58 / React Native 0.88 Hermes project. Install both local tarballs, Pi Codemode 1.3.0 and Pi Durable 1.3.0, then copy `App.tsx` as the entry. Use the documented `withPiCodemodeExpo` Metro helper for Pi Durable 1.3.0; use no sibling source dependencies. Build with `npx expo run:ios` / `npx expo run:android`; Expo Go cannot load the custom native engine.

1. Run “Controlled player mapping”: check two mapped players, return value 2, and successful store writes. It uses delayed local JSON, without credentials or paid requests.
2. Run each loop: confirm the Hermes counter advances, press Cancel, and inspect `kind: aborted`. Without Cancel, check the deadline result.
3. Repeat starts/cancels, background/foreground and reload while waiting for a tool. Check that all calls settle and old runs do not emit into the next app instance.
4. Wire the app's existing Pi Durable SQLite `Storage` into `openReplayScenario` from `durable-scenario.ts`. Do not install a second journal. Stop while the controlled wait is pending, close sandbox before Harness, reopen the same SQLite storage with a fresh engine/sandbox, and wait for the saved task ID. Expect one completed read and a replayed safe wait; repeat with `replay: unsafe` and a changed effective output budget.

The executable host scenarios in `tests/durable-replay.test.ts` demonstrate the actual `Harness.open`, `createCodemodeExtension`, `ToolTask`, SQLite reopen and `CodemodeStoreDoc` assertions. They use Node's SQLite provider only in the test graph. For mobile, supply the app's supported portable SQLite provider (`@earendil-works/pi-durable/storage/sqlite`), never the `/node` provider.

Mobile replay scenario acceptance: completed nested result is retained; interrupted unsafe tool never runs again; success commits store writes; abort/failure withholds them; fingerprint divergence admits no new effect. The native session exercised adapter tools/store and deterministic start on an iOS 26.2 arm64 simulator. Native mobile SQLite replay and Android execution have not been run. Keep simulator/device results separate from host C++/SQLite evidence.

```ts
// first storage is opened by your app's existing Pi SQLite provider:
const first = await openReplayScenario(storage, engine, {
  waitAtCheckpoint: true, replay: 'safe', onEffect: console.log,
});
const taskId = await first.begin(); // retain this ID outside the process
// after onEffect('wait') fires:
await first.close();
// reopen the same database and create a fresh engine:
const second = await openReplayScenario(reopenedStorage, freshEngine, {
  waitAtCheckpoint: false, replay: 'safe', onEffect: console.log,
});
await second.resume(taskId);
console.log(await second.store());
await second.close();
```

The second instance must not log `read`; a safe interrupted wait can log `wait` again. With `replay: 'unsafe'` in both opens, it must not log `wait` again. With a different `limits.outputBytes` in the second open, the stored tool result reports fingerprint mismatch, `after` never logs, and no staged store writes commit. The caller owns/ closes `engine` separately.


`smoke.ts` preserves the self-contained adapter scenario exercised on iOS. Call
`await runAdapterSmoke(engine)` using the app-owned engine; it checks delayed
Unicode tool/store and deterministic UTC Date/performance/random/WeakRef behavior.
The caller closes the engine after all its sandboxes finish.
