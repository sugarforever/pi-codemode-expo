import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPublish } from "./check-publish-state.mjs";
test("publishes an unpublished version", () =>
  assert.equal(shouldPublish("sha512-current", null), true));
test("skips only an identical already-published artifact", () =>
  assert.equal(shouldPublish("sha512-current", "sha512-current"), false));
test("blocks reuse of a version for different contents", () =>
  assert.throws(
    () => shouldPublish("sha512-current", "sha512-other"),
    /different/,
  ));
