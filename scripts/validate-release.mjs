import { readFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
export function validateRelease({ tag, version, prerelease }) {
  if (typeof prerelease !== "boolean")
    throw Error("Release prerelease flag must be boolean");
  if (typeof version !== "string" || tag !== `v${version}`)
    throw Error("Release tag must match package.json version (v<version>)");
  return prerelease || version.includes("-") ? "next" : "latest";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const flag = process.env.RELEASE_PRERELEASE;
  if (flag !== "true" && flag !== "false")
    throw Error("Missing boolean RELEASE_PRERELEASE");
  const { version } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const tag = validateRelease({
    tag: process.env.RELEASE_TAG,
    version,
    prerelease: flag === "true",
  });
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `publish-tag=${tag}\n`);
  console.log(`Validated v${version}; npm dist-tag: ${tag}`);
}
