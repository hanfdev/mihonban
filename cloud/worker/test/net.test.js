import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithTimeout } from "../src/net.js";

test("shared backend fetch guard aborts a stalled request", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
  try {
    await assert.rejects(fetchWithTimeout("https://example.test", {}, 5),
      (error) => error?.name === "AbortError");
  } finally {
    globalThis.fetch = realFetch;
  }
});
