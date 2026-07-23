import assert from "node:assert/strict";
import test from "node:test";

import { resumableOffset } from "../src/api.js";

test("Google resumable 308 responses advance to the acknowledged byte", () => {
  assert.equal(resumableOffset(308, "bytes=0-10485759", 20 * 1024 * 1024),
    10 * 1024 * 1024);
  assert.equal(resumableOffset(308, null, 10 * 1024 * 1024), null);
  assert.equal(resumableOffset(202, "bytes=0-9", 10), null);
  assert.equal(resumableOffset(202, null, 20,
    JSON.stringify({ nextExpectedRanges: ["12-"] })), 12);
  assert.equal(resumableOffset(202, null, 20, "not-json"), null);
});
