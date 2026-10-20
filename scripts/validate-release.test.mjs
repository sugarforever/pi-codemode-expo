import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRelease } from "./validate-release.mjs";
test("requires the release tag to match package version", () => {
  assert.throws(
    () =>
      validateRelease({ tag: "v0.2.0", version: "0.1.0", prerelease: false }),
    /match/,
  );
});
test("uses next for experimental releases and latest for stable releases", () => {
  assert.equal(
    validateRelease({ tag: "v0.1.0", version: "0.1.0", prerelease: true }),
    "next",
  );
  assert.equal(
    validateRelease({
      tag: "v1.0.0-beta.1",
      version: "1.0.0-beta.1",
      prerelease: false,
    }),
    "next",
  );
  assert.equal(
    validateRelease({ tag: "v1.0.0", version: "1.0.0", prerelease: false }),
    "latest",
  );
});
test("rejects malformed release metadata", () => {
  assert.throws(
    () =>
      validateRelease({ tag: "v0.1.0", version: "0.1.0", prerelease: "false" }),
    /boolean/,
  );
});
