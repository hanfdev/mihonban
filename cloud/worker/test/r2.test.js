import assert from "node:assert/strict";
import test from "node:test";

import { r2Conf, r2PublicObjectExists, r2Test } from "../src/r2.js";

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

test("R2 public object checks use HEAD and distinguish missing objects", async () => {
  const conf = { publicUrl: "https://cdn.example" };
  const realFetch = globalThis.fetch;
  const calls = [];
  const statuses = [200, 404, 403];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method, headers: init.headers });
    return new Response(null, { status: statuses.shift() });
  };
  try {
    assert.equal(await r2PublicObjectExists(conf, "img/existing.jpg"), true);
    assert.equal(await r2PublicObjectExists(conf, "img/missing.jpg"), false);
    await assert.rejects(
      r2PublicObjectExists(conf, "img/forbidden.jpg"), /failed: 403/);
    assert.deepEqual(calls.map((call) => call.method), ["HEAD", "HEAD", "HEAD"]);
    assert.equal(calls[0].url, "https://cdn.example/img/existing.jpg");
    assert.equal(calls[0].headers["Cache-Control"], "no-cache");
  } finally {
    globalThis.fetch = realFetch;
  }
});
