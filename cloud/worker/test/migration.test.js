import assert from "node:assert/strict";
import test from "node:test";

import { uploadResponseToSession } from "../src/index.js";

const sourceResponse = (bytes) => new Response(new Uint8Array(bytes), {
  headers: { "Content-Length": String(bytes.length) },
});

test("migration upload rejects a partially acknowledged resumable chunk", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 308, headers: { Range: "bytes=0-1" },
  });
  try {
    await assert.rejects(uploadResponseToSession(
      "https://upload.example/session", sourceResponse([1, 2, 3, 4]),
      4, "application/octet-stream"), /确认位置不符/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("migration upload accepts Graph nextExpectedRanges acknowledgement", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    nextExpectedRanges: ["4-"],
  }), { status: 202, headers: { "Content-Type": "application/json" } });
  try {
    assert.equal(await uploadResponseToSession(
      "https://upload.example/session", sourceResponse([1, 2, 3, 4]),
      4, "application/octet-stream"), 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});
