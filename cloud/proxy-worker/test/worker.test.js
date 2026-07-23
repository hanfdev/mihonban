import assert from "node:assert/strict";
import test from "node:test";

import proxy, { hostAllowed, signature } from "../worker.js";

const source = "https://audio.example.com/library/track.flac?download=1";
const secret = "test-proxy-secret-0123456789abcdef";
const env = {
  PROXY_SECRET: secret,
  ALLOWED_HOSTS: "audio.example.com,.sharepoint.com",
  ALLOWED_ORIGINS: "https://music.example.com",
};

test("host allowlist matches exact hosts and real subdomains only", () => {
  assert.equal(hostAllowed("audio.example.com", ["audio.example.com"]), true);
  assert.equal(hostAllowed("x.sharepoint.com", [".sharepoint.com"]), true);
  assert.equal(hostAllowed("sharepoint.com", [".sharepoint.com"]), false);
  assert.equal(hostAllowed("evilsharepoint.com", [".sharepoint.com"]), false);
});

test("proxy fails closed without a configured secret", async () => {
  const request = new Request(`https://proxy.example/?url=${encodeURIComponent(source)}`);
  const response = await proxy.fetch(request, {
    ALLOWED_HOSTS: "audio.example.com",
  });
  assert.equal(response.status, 401);
});

test("proxy rejects a weak configured secret", async () => {
  const weak = "short-secret";
  const expires = Math.floor(Date.now() / 1000) + 300;
  const sig = await signature(source, expires, weak);
  const request = new Request(
    `https://proxy.example/?url=${encodeURIComponent(source)}&expires=${expires}&sig=${sig}`);
  const response = await proxy.fetch(request, {
    PROXY_SECRET: weak, ALLOWED_HOSTS: "audio.example.com",
  });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /configured securely/);
});

test("proxy converts upstream network failures into a bounded 502", async () => {
  const expires = Math.floor(Date.now() / 1000) + 300;
  const sig = await signature(source, expires, secret);
  const request = new Request(
    `https://proxy.example/?url=${encodeURIComponent(source)}&expires=${expires}&sig=${sig}`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("private network detail"); };
  try {
    const response = await proxy.fetch(request, env);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "upstream connection failed");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("signed proxy forwards byte ranges and preserves partial response headers", async () => {
  const expires = Math.floor(Date.now() / 1000) + 300;
  const sig = await signature(source, expires, secret);
  const request = new Request(
    `https://proxy.example/?url=${encodeURIComponent(source)}&expires=${expires}&sig=${sig}`,
    { headers: { Range: "bytes=10-19", Origin: "https://music.example.com" } });
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (input, init) => {
    called = true;
    assert.equal(String(input), source);
    assert.equal(init.headers.get("Range"), "bytes=10-19");
    assert.equal(init.redirect, "manual");
    return new Response("0123456789", {
      status: 206,
      headers: {
        "Content-Type": "audio/flac",
        "Content-Range": "bytes 10-19/100",
        "Accept-Ranges": "bytes",
      },
    });
  };
  try {
    const response = await proxy.fetch(request, env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 10-19/100");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"),
      "https://music.example.com");
    assert.equal(await response.text(), "0123456789");
    assert.equal(called, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("signed proxy rejects a source outside the host allowlist", async () => {
  const bad = "https://127.0.0.1/private";
  const expires = Math.floor(Date.now() / 1000) + 300;
  const sig = await signature(bad, expires, secret);
  const request = new Request(
    `https://proxy.example/?url=${encodeURIComponent(bad)}&expires=${expires}&sig=${sig}`);
  assert.equal((await proxy.fetch(request, env)).status, 403);
});
