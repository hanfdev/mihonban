import assert from "node:assert/strict";
import test from "node:test";

import { createUploadSession, createUploadSessionWith,
         accessToken, downloadUrlWith, listChildren } from "../src/graph.js";

function fakeEnv() {
  const cache = new Map([["ms:token", JSON.stringify({
    access_token: "cached-token",
    expires_at: Date.now() + 600_000,
  })]]);
  return {
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    },
    KV: {
      get: async (key, type) => {
        const value = cache.get(key) ?? null;
        return type === "json" && value ? JSON.parse(value) : value;
      },
      put: async (key, value) => cache.set(key, String(value)),
      delete: async (key) => cache.delete(key),
    },
    MS_CLIENT_ID: "client",
    MS_CLIENT_SECRET: "secret",
    MS_REFRESH_TOKEN: "refresh",
    MS_DRIVE_ID: "drive",
  };
}

test("Graph upload session automatically retries a transient 503", async () => {
  const env = fakeEnv();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("service unavailable", {
        status: 503,
        headers: { "Retry-After": "0" },
      });
    }
    return Response.json({ uploadUrl: "https://upload.example/session" });
  };
  try {
    assert.equal(await createUploadSession(env, "Music/Library/A/01.flac"),
      "https://upload.example/session");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("named OneDrive upload session retries and reports the final Graph error", async () => {
  const env = fakeEnv();
  const config = {
    clientId: "client", clientSecret: "secret", refreshToken: "refresh", driveId: "named-drive",
  };
  await env.KV.put("msT:named-drive", JSON.stringify({
    access_token: "cached-token",
    expires_at: Date.now() + 600_000,
  }));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("still unavailable", {
      status: 503,
      headers: { "Retry-After": "0" },
    });
  };
  try {
    await assert.rejects(
      createUploadSessionWith(env, config, "Music/Library/A/01.flac"),
      /upload session failed: 503 still unavailable/);
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("named OneDrive token caches are isolated by storage id", async () => {
  const env = fakeEnv();
  const one = {
    __storageId: "one", clientId: "client", clientSecret: "secret",
    refreshToken: "refresh-one", driveId: "shared-drive",
  };
  const two = {
    __storageId: "two", clientId: "client", clientSecret: "secret",
    refreshToken: "refresh-two", driveId: "shared-drive",
  };
  await env.KV.put("msT:one", JSON.stringify({
    access_token: "token-one", expires_at: Date.now() + 600_000,
  }));
  await env.KV.put("msT:two", JSON.stringify({
    access_token: "token-two", expires_at: Date.now() + 600_000,
  }));
  const realFetch = globalThis.fetch;
  const auth = [];
  globalThis.fetch = async (_input, init = {}) => {
    auth.push(init.headers.Authorization);
    return Response.json({
      "@microsoft.graph.downloadUrl": `https://download.example/${auth.length}`,
    });
  };
  try {
    assert.equal(await downloadUrlWith(env, one, "Music/Library/A/one.flac"),
      "https://download.example/1");
    assert.equal(await downloadUrlWith(env, two, "Music/Library/A/one.flac"),
      "https://download.example/2");
    assert.deepEqual(auth, ["Bearer token-one", "Bearer token-two"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Graph token refresh rejects malformed token responses", async () => {
  const env = fakeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ expires_in: 3600 });
  try {
    await assert.rejects(accessToken(env, true), /invalid token response/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Graph listing rejects malformed child names in strict mode", async () => {
  const env = fakeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    value: [{ id: "bad", name: "../escape", file: {} }],
  });
  try {
    assert.deepEqual(await listChildren(env, "Music/Library/Artist"), []);
    await assert.rejects(
      listChildren(env, "Music/Library/Artist", true), /item invalid/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Graph listing stops repeated pagination links", async () => {
  const env = fakeEnv();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      value: [],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/repeat",
    });
  };
  try {
    assert.deepEqual(await listChildren(env, "Music/Library/Artist"), []);
    assert.equal(calls, 2);
    await assert.rejects(
      listChildren(env, "Music/Library/Artist", true), /pagination exceeded/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
