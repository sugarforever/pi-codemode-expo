import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, basename } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const native = process.argv[2];
if (!native)
  throw Error(
    "Usage: node scripts/check-package.mjs /absolute/path/to/expo-quickjs-0.1.0.tgz",
  );
await mkdir(join(root, ".tmp"), { recursive: true });
const consumer = await mkdtemp(join(root, ".tmp", "consumer-"));
const packed = JSON.parse(run("npm", ["pack", "--json"]));
const archive = join(root, packed[0].filename);
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify({
    name: "packed-adapter-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
  }),
);
run(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--legacy-peer-deps",
    archive,
    resolve(native),
    "@earendil-works/pi-durable@1.3.0",
    "typescript@5.9.3",
    "@types/node@24",
    "vitest@4.1.12",
  ],
  consumer,
);
await writeFile(
  join(consumer, "consumer.ts"),
  await readFile(join(root, "tests/type-compatibility.ts")),
);
run(
  join(consumer, "node_modules/.bin/tsc"),
  [
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "nodenext",
    "--target",
    "es2022",
    "consumer.ts",
    "node_modules/pi-codemode-expo/examples/expo/durable-scenario.ts",
    "node_modules/pi-codemode-expo/examples/expo/smoke.ts",
  ],
  consumer,
);
// Import public built JS in Node with no Expo or WASM globals, and inspect the entire reachable graph.
await writeFile(
  join(consumer, "smoke.mjs"),
  `
globalThis.WebAssembly=undefined;
const {ExpoCodemodeSandbox}=await import('pi-codemode-expo');
const {createCodemodeExtension}=await import('@earendil-works/pi-durable/codemode');
const sandbox=new ExpoCodemodeSandbox({channel:{fingerprint:'package-test',start:async(_data,events)=>{queueMicrotask(()=>events.message({type:'done',ok:true,value:'42',writes:'[]'}));return {post(){},async stop(){}}}}});
createCodemodeExtension({sandbox,models:false});
const result=await sandbox.execute('return 42');
if(!result.ok||result.value!==42)throw Error('Packed runtime smoke failed');
await sandbox.close();
`,
);
run("node", ["smoke.mjs"], consumer);
// Apply the exact Metro resolver to real Pi Durable public imports, rejecting
// any transitive Node or WASM implementation in that graph.
await writeFile(
  join(consumer, "mobile-graph.mjs"),
  `
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {withPiCodemodeExpo} from 'pi-codemode-expo/metro';
const resolve=withPiCodemodeExpo({}).resolver.resolveRequest;
registerHooks({resolve(name,context,next){
 if(name.startsWith('node:'))throw Error('Unexpected mobile Node import: '+name);
 const result=resolve({originModulePath:context.parentURL?.startsWith('file:')?fileURLToPath(context.parentURL):'',resolveRequest:(_context,redirect)=>next(redirect,context)},name,'ios');
 if(result.url.includes('quickjs-wasi'))throw Error('Unexpected WASM import '+result.url);
 return result;
}});
globalThis.WebAssembly=undefined;
const {createCodemodeExtension}=await import('@earendil-works/pi-durable/codemode');
const {ExpoCodemodeSandbox}=await import('pi-codemode-expo');
const s=new ExpoCodemodeSandbox({channel:{fingerprint:'controlled',start(){throw Error('not used');}}});
createCodemodeExtension({sandbox:s,models:false});await s.close();
`,
);
run("node", ["mobile-graph.mjs"], consumer);
const dist = join(consumer, "node_modules/pi-codemode-expo/dist");
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await scan(path);
    else if (path.endsWith(".js")) {
      const source = await readFile(path, "utf8");
      if (
        /(?:from\s*|import\s*\()['"](?:node:|quickjs-wasi|@earendil-works|expo-quickjs)/.test(
          source,
        )
      )
        throw Error(`Unexpected mobile runtime dependency: ${path}`);
    }
  }
}
await scan(dist);
for (const required of [
  "LICENSE",
  "NOTICE",
  "vendor/pi/LICENSE",
  "vendor/pi/provenance.json",
  "docs/native-channel.md",
  "docs/verification.md",
])
  await readFile(join(consumer, "node_modules/pi-codemode-expo", required));
// Re-run every adapter test using installed compiled artifact imports, never sibling source.
await mkdir(join(consumer, "tests/support"), { recursive: true });
for (const file of (await readdir(join(root, "tests"))).filter((name) =>
  name.endsWith(".test.ts"),
)) {
  let source = await readFile(join(root, "tests", file), "utf8");
  source = source
    .replaceAll("../src/index.js", "pi-codemode-expo")
    .replaceAll("../src/protocol.js", "pi-codemode-expo")
    .replaceAll("../src/metro.js", "pi-codemode-expo/metro")
    .replaceAll(
      "../src/bootstrap.js",
      "../node_modules/pi-codemode-expo/dist/bootstrap.js",
    );
  await writeFile(join(consumer, "tests", file), source);
}
let support = await readFile(
  join(root, "tests/support/native-engine.ts"),
  "utf8",
);
support = support.replaceAll("../../src/protocol.js", "pi-codemode-expo");
await writeFile(join(consumer, "tests/support/native-engine.ts"), support);
process.env.EXPO_QUICKJS_RUNNER ??= resolve(
  root,
  "../expo-quickjs/build/channel_runner",
);
const suiteOutput = run(
  join(consumer, "node_modules/.bin/vitest"),
  ["run"],
  consumer,
);
await writeFile(join(consumer, "full-test-output.txt"), suiteOutput);
const report = {
  consumer: relative(root, consumer),
  archive: basename(archive),
  native: basename(native),
  nativeSha256: createHash("sha256").update(await readFile(resolve(native))).digest("hex"),
  archiveSha256: createHash("sha256").update(await readFile(archive)).digest("hex"),
  checks: [
    "public package type compatibility with actual native facade and Pi Durable",
    "packed JS import with WebAssembly unavailable",
    "real createCodemodeExtension runtime smoke",
    "mobile JS graph has no Node/Pi/WASM imports",
    "MIT notices/provenance present",
    "actual Pi Durable mobile graph via Metro helper rejects Node/WASM imports",
    "full adapter/native/Harness/SQLite suite rerun against installed compiled artifact",
  ],
  limitations: [
    "No Expo native build/device run in this check; Expo peer dependencies intentionally not installed.",
  ],
};
await writeFile(
  join(root, "docs/package-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
