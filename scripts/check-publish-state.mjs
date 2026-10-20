import { readFile, readdir, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
export function shouldPublish(expected, existing) {
  if (existing === null) return true;
  if (existing !== expected)
    throw Error(
      "This version already exists with different contents; bump the package version",
    );
  return false;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory = process.argv[2] ?? "release-package";
  const archives = (await readdir(directory)).filter((file) =>
    file.endsWith(".tgz"),
  );
  if (archives.length !== 1)
    throw Error("Expected exactly one verified package archive");
  const expected =
    "sha512-" +
    createHash("sha512")
      .update(await readFile(join(directory, archives[0])))
      .digest("base64");
  const { name, version } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  let existing;
  try {
    existing = JSON.parse(
      execFileSync(
        "npm",
        [
          "view",
          `${name}@${version}`,
          "dist.integrity",
          "--json",
          "--registry=https://registry.npmjs.org",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    if (typeof existing !== "string" || !existing)
      throw Error("Registry response has no package integrity");
  } catch (error) {
    let response;
    try {
      response = JSON.parse(String(error.stdout));
    } catch {}
    if (response?.error?.code !== "E404") throw error;
    existing = null;
  }
  const publish = shouldPublish(expected, existing);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `should-publish=${publish}\n`);
  console.log(
    publish
      ? `${name}@${version} is not published; ready to publish`
      : `${name}@${version} already matches this verified artifact; skipping publish`,
  );
}
