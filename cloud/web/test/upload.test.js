import assert from "node:assert/strict";
import test from "node:test";

import {
  resumableOffset, resumableStatusOffset, uploadFileToOneDrive,
} from "../src/api.js";

test("Google resumable 308 responses advance to the acknowledged byte", () => {
  assert.equal(resumableOffset(308, "bytes=0-10485759", 20 * 1024 * 1024),
    10 * 1024 * 1024);
  assert.equal(resumableOffset(308, null, 10 * 1024 * 1024), null);
  assert.equal(resumableOffset(202, "bytes=0-9", 10), null);
  assert.equal(resumableOffset(202, null, 20,
    JSON.stringify({ nextExpectedRanges: ["12-"] })), 12);
  assert.equal(resumableOffset(202, null, 20, "not-json"), null);
});

test("resumable status queries recover provider offsets conservatively", () => {
  assert.equal(resumableStatusOffset("gdrive", 308, "bytes=0-99", "", 200), 100);
  assert.equal(resumableStatusOffset("gdrive", 308, null, "", 200), 0);
  assert.equal(resumableStatusOffset("gdrive", 201, null, "", 200), 200);
  assert.equal(resumableStatusOffset("onedrive", 200, null,
    JSON.stringify({ nextExpectedRanges: ["100-"] }), 200), 100);
  assert.equal(resumableStatusOffset("onedrive", 200, null, "{}", 200), null);
  assert.equal(resumableStatusOffset("onedrive", 404, null, "", 200), null);
});

test("proxy uploads retry repeated transient failures and verify stored size", async () => {
  const originalFetch = globalThis.fetch;
  const OriginalXHR = globalThis.XMLHttpRequest;
  let proxyAttempts = 0;
  let verificationCalls = 0;
  const urls = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "/api/upload/session") {
      return new Response(JSON.stringify({
        proxy: true, storageId: "local-test",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/upload/verify") {
      verificationCalls += 1;
      assert.deepEqual(JSON.parse(init.body), {
        path: "Music/Library/Artist/Album/01.flac",
        storageId: "local-test",
        size: 12,
      });
      return new Response(JSON.stringify({
        ok: true, actualSize: 12, expectedSize: 12,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  globalThis.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.responseText = "";
      this.status = 0;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
      urls.push(url);
    }

    setRequestHeader() {}

    getResponseHeader(name) {
      return name.toLowerCase() === "retry-after" ? "0" : null;
    }

    send(body) {
      assert.equal(body.size, 12);
      proxyAttempts += 1;
      if (proxyAttempts < 4) {
        this.status = 503;
        this.responseText = JSON.stringify({ error: "temporary outage" });
      } else {
        this.status = 200;
        this.responseText = JSON.stringify({ ok: true });
      }
      queueMicrotask(() => this.onload());
    }
  };

  try {
    const file = new Blob([new Uint8Array(12)], { type: "audio/flac" });
    await uploadFileToOneDrive(
      "Music/Library/Artist/Album/01.flac", file);
    assert.equal(proxyAttempts, 4);
    assert.equal(verificationCalls, 1);
    assert.ok(urls.every((url) => url.includes("size=12")));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = OriginalXHR;
  }
});

test("direct uploads resume from the provider offset after a lost acknowledgement", async () => {
  const originalFetch = globalThis.fetch;
  const OriginalXHR = globalThis.XMLHttpRequest;
  const ranges = [];
  let statusQueries = 0;
  let chunkPuts = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "/api/upload/session") {
      return new Response(JSON.stringify({
        uploadUrl: "https://upload.test/session",
        provider: "onedrive",
        storageId: "onedrive-test",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/upload/verify") {
      assert.deepEqual(JSON.parse(init.body), {
        path: "Music/Library/Artist/Album/01.flac",
        storageId: "onedrive-test",
        size: 12,
      });
      return new Response(JSON.stringify({
        ok: true, actualSize: 12, expectedSize: 12,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  globalThis.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.headers = {};
      this.responseText = "";
      this.status = 0;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headers[name] = value;
    }

    getResponseHeader() { return null; }

    send() {
      if (this.method === "GET") {
        statusQueries += 1;
        this.status = 200;
        this.responseText = JSON.stringify({ nextExpectedRanges: ["6-"] });
        queueMicrotask(() => this.onload());
        return;
      }
      chunkPuts += 1;
      ranges.push(this.headers["Content-Range"]);
      if (chunkPuts === 1) {
        queueMicrotask(() => this.onerror());
        return;
      }
      this.status = 201;
      this.responseText = JSON.stringify({ id: "uploaded" });
      queueMicrotask(() => this.onload());
    }
  };

  try {
    const file = new Blob([new Uint8Array(12)], { type: "audio/flac" });
    const item = await uploadFileToOneDrive(
      "Music/Library/Artist/Album/01.flac", file);
    assert.equal(item.id, "uploaded");
    assert.equal(statusQueries, 1);
    assert.deepEqual(ranges, ["bytes 0-11/12", "bytes 6-11/12"]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = OriginalXHR;
  }
});
