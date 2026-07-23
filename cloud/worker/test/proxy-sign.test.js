import assert from "node:assert/strict";
import test from "node:test";

import { signature } from "../../proxy-worker/worker.js";
import { signProxyTarget } from "../src/proxy-sign.js";

test("main Worker signs a hand-off accepted by the proxy Worker", async () => {
  const source = "https://audio.example.com/track.mp3?download=1";
  const secret = "shared-secret-0123456789abcdefXYZ";
  const result = new URL(await signProxyTarget(
    `https://proxy.example/?url=${encodeURIComponent(source)}`,
    source, secret, 300));
  const expires = Number(result.searchParams.get("expires"));
  assert.ok(expires > Math.floor(Date.now() / 1000));
  assert.equal(result.searchParams.get("url"), source);
  assert.equal(result.searchParams.get("sig"),
    await signature(source, expires, secret));
});

test("main Worker refuses a weak proxy signing secret", async () => {
  await assert.rejects(signProxyTarget(
    "https://proxy.example/?url=x", "https://audio.example/x", "short"),
  /at least 32/);
});
