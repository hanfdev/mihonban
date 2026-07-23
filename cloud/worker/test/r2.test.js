import assert from "node:assert/strict";
import test from "node:test";

import { r2Conf, r2Test } from "../src/r2.js";

test("R2 config fails closed for malformed environment URLs", async () => {
  const env = {
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    },
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "javascript:bad",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "not a url",
  };
  const conf = await r2Conf(env);
  assert.equal(conf.endpoint, "");
  assert.equal(conf.publicUrl, "");
  assert.equal(conf.ready, false);
  assert.equal(conf.configured, false);
});

test("R2 connectivity probes use a unique object and remove it", async () => {
  const conf = {
    accessKey: "access", secretKey: "secret",
    endpoint: "https://r2.example", bucket: "bucket",
    publicUrl: "https://cdn.example", configured: true,
  };
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method || "GET" });
    return new Response(init.method === "GET" ? "ok" : null, {
      status: init.method === "PUT" ? 201 : 200,
    });
  };
  try {
    assert.deepEqual(await r2Test(conf), { ok: true });
    assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET", "DELETE"]);
    const putKey = new URL(calls[0].url).pathname.split("/bucket/")[1];
    const getKey = new URL(calls[1].url).pathname.slice(1);
    const deleteKey = new URL(calls[2].url).pathname.split("/bucket/")[1];
    assert.match(putKey, /^_probe\/mihonban-[a-z0-9-]+\.txt$/);
    assert.equal(getKey, putKey);
    assert.equal(deleteKey, putKey);
  } finally {
    globalThis.fetch = realFetch;
  }
});
