import assert from "node:assert/strict";
import test from "node:test";

import { R2_IMAGE_CACHE_CONTROL, r2ApplyImageCacheControl, r2Conf,
  r2PublicObjectExists, r2PublicUrl, r2Put, r2Test } from "../src/r2.js";

test("R2 public URLs use a stable cache-busting mirror version", () => {
  const conf = { publicUrl: "https://cdn.example" };
  assert.equal(r2PublicUrl(conf, "img/cover.jpg"),
    "https://cdn.example/img/cover.jpg");
  assert.equal(r2PublicUrl(conf, "img/cover.jpg", 123456),
    "https://cdn.example/img/cover.jpg?v=123456");
});

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

test("R2 image objects carry an immutable browser cache policy", async () => {
  const conf = {
    accessKey: "access", secretKey: "secret",
    endpoint: "https://r2.example", bucket: "bucket",
  };
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), ...init });
    return new Response(null, { status: 201 });
  };
  try {
    assert.equal(await r2Put(
      conf, "img/cover.jpg", new Uint8Array([1, 2, 3]), "image/jpeg"), true);
    assert.equal(requests[0].headers["Cache-Control"], R2_IMAGE_CACHE_CONTROL);

    requests.length = 0;
    assert.equal(await r2Put(
      conf, "_probe/test.txt", new Uint8Array([1]), "text/plain"), true);
    assert.equal(requests[0].headers["Cache-Control"], undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("existing R2 images upgrade cache metadata with an internal copy", async () => {
  const conf = {
    accessKey: "access", secretKey: "secret",
    endpoint: "https://r2.example", bucket: "bucket",
  };
  const realFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init = {}) => {
    request = { url: String(input), ...init };
    return new Response(null, { status: 200 });
  };
  try {
    assert.equal(await r2ApplyImageCacheControl(
      conf, "img/art_album_480.jpg", "image/jpeg"), true);
    assert.equal(request.method, "PUT");
    assert.equal(request.headers["Cache-Control"], R2_IMAGE_CACHE_CONTROL);
    assert.equal(request.headers["x-amz-copy-source"],
      "/bucket/img/art_album_480.jpg");
    assert.equal(request.headers["x-amz-metadata-directive"], "REPLACE");
    assert.equal(request.body, undefined);
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
