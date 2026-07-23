import assert from "node:assert/strict";
import test from "node:test";

import { authUrl, cacheNamespace, createUploadSession,
  deleteItem, getFile, invalidatePathCache, listChildren } from "../src/gdrive.js";

function mapKv(cache) {
  return {
    async get(key, type) {
      const value = cache.get(key) ?? null;
      return type === "json" && value ? JSON.parse(value) : value;
    },
    async put(key, value) { cache.set(key, String(value)); },
    async delete(key) { cache.delete(key); },
    async list({ prefix }) {
      return {
        keys: [...cache.keys()].filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      };
    },
  };
}

test("Google authorization requests access to an existing writable library", () => {
  const url = new URL(authUrl("client-id"));
  assert.equal(url.searchParams.get("scope"),
    "https://www.googleapis.com/auth/drive");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost");
});

test("Google cache namespaces separate accounts sharing one OAuth client", async () => {
  const first = {
    clientId: "shared-client", refreshToken: "refresh-account-a",
  };
  const second = {
    clientId: "shared-client", refreshToken: "refresh-account-b",
  };
  assert.notEqual(await cacheNamespace(first), await cacheNamespace(second));
  assert.equal(await cacheNamespace(first), await cacheNamespace({
    clientId: "shared-client", refreshToken: "refresh-account-a",
  }));
});

test("deleting a Google Drive folder invalidates descendant path caches", async () => {
  const values = new Map();
  const deleted = [];
  const env = {
    KV: {
      async list({ prefix }) {
        return {
          keys: [...values.keys()].filter((key) => key.startsWith(prefix))
            .map((name) => ({ name })),
          list_complete: true,
          cursor: "",
        };
      },
      async delete(key) { deleted.push(key); values.delete(key); },
    },
  };
  const conf = {
    __storageId: "drive-a",
    clientId: "client", refreshToken: "refresh", rootId: "root",
  };
  const ns = await cacheNamespace(conf);
  values.set(`gdF:${ns}:root:Artist/Album`, "folder");
  values.set(`gdF:${ns}:root:Artist/Album/01.mp3`, "track");
  values.set(`gdF:${ns}:root:Artist/Album-art`, "unrelated");
  await invalidatePathCache(env, conf, "Artist/Album");
  assert.deepEqual([...values.keys()], [`gdF:${ns}:root:Artist/Album-art`]);
  assert.equal(deleted.length, 2);
});

test("Google Drive creates a browser-direct resumable upload session", async () => {
  const cache = new Map();
  const env = {
    KV: {
      async get(key, type) {
        const value = cache.get(key) ?? null;
        return type === "json" && value ? JSON.parse(value) : value;
      },
      async put(key, value) { cache.set(key, String(value)); },
    },
  };
  const conf = {
    __storageId: "drive-upload", clientId: "client", clientSecret: "secret",
    refreshToken: "refresh", rootId: "root",
  };
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "token", expires_in: 3600 });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
      return Response.json({ files: [] });
    }
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?")) {
      return new Response(null, {
        status: 200, headers: { Location: "https://upload.example/session" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    assert.equal(await createUploadSession(env, conf, "track.flac"),
      "https://upload.example/session");
    const create = calls.find((call) => call.url.includes("upload/drive/v3"));
    assert.equal(create.init.method, "POST");
    assert.equal(create.init.headers["X-Upload-Content-Type"],
      "application/octet-stream");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Google Drive rejects a malformed resumable upload URL", async () => {
  const cache = new Map();
  const env = { KV: mapKv(cache) };
  const conf = {
    __storageId: "drive-upload-invalid", clientId: "client", clientSecret: "secret",
    refreshToken: "refresh", rootId: "root",
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "token", expires_in: 3600 });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
      return Response.json({ files: [] });
    }
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?")) {
      return new Response(null, { status: 200, headers: { Location: "javascript:bad" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await assert.rejects(createUploadSession(env, conf, "track.flac"),
      /valid upload session URL/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Google Drive refreshes stale path ids before reading or deleting replacements", async () => {
  const cache = new Map();
  const conf = {
    __storageId: "drive-stale", clientId: "client", clientSecret: "secret",
    refreshToken: "refresh", rootId: "root",
  };
  const ns = await cacheNamespace(conf);
  const tokenKey = `gdT:${ns}`;
  cache.set(tokenKey, JSON.stringify({
    access_token: "cached-token", expires_at: Date.now() + 600_000,
  }));
  const path = "Artist/Album/track.flac";
  const pathKey = `gdF:${ns}:root:${path}`;
  cache.set(pathKey, JSON.stringify({ id: "stale-file", mimeType: "audio/flac" }));
  const env = { KV: mapKv(cache) };
  const realFetch = globalThis.fetch;
  const deletedIds = [];
  let replacementId = "fresh-file-read";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/files/stale-file?alt=media")) {
      return new Response("gone", { status: 404 });
    }
    if (url.endsWith("/files/fresh-file-read?alt=media")) {
      return new Response("fresh audio", { status: 200 });
    }
    if (url.includes("/drive/v3/files?") && !url.includes("alt=media")) {
      const q = new URL(url).searchParams.get("q") || "";
      if (q.includes("name = 'Artist'")) {
        return Response.json({ files: [{
          id: "fresh-artist", name: "Artist",
          mimeType: "application/vnd.google-apps.folder",
        }] });
      }
      if (q.includes("name = 'Album'")) {
        return Response.json({ files: [{
          id: "fresh-album", name: "Album",
          mimeType: "application/vnd.google-apps.folder",
        }] });
      }
      if (q.includes("name = 'track.flac'")) {
        return Response.json({ files: [{
          id: replacementId, name: "track.flac", mimeType: "audio/flac",
        }] });
      }
    }
    const deleteMatch = /\/files\/([^?]+)$/.exec(url);
    if (init.method === "DELETE" && deleteMatch) {
      deletedIds.push(deleteMatch[1]);
      if (deleteMatch[1] === "stale-delete") {
        return new Response("gone", { status: 404 });
      }
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const response = await getFile(env, conf, path);
    assert.equal(await response.text(), "fresh audio");
    assert.equal(JSON.parse(cache.get(pathKey)).id, "fresh-file-read");

    replacementId = "fresh-delete";
    cache.set(pathKey, JSON.stringify({ id: "stale-delete", mimeType: "audio/flac" }));
    assert.equal(await deleteItem(env, conf, path), true);
    assert.deepEqual(deletedIds, ["stale-delete", "fresh-delete"]);
    assert.equal(cache.has(pathKey), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Google Drive listing skips or rejects unsafe child names", async () => {
  const cache = new Map();
  const conf = {
    __storageId: "drive-list", clientId: "client", refreshToken: "refresh", rootId: "root",
  };
  const ns = await cacheNamespace(conf);
  cache.set(`gdT:${ns}`, JSON.stringify({
    access_token: "cached-token", expires_at: Date.now() + 600_000,
  }));
  const env = { KV: mapKv(cache) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ files: [
    { id: "bad", name: "../escape", mimeType: "audio/flac", size: "3" },
  ] });
  try {
    assert.deepEqual(await listChildren(env, conf, ""), []);
    await assert.rejects(listChildren(env, conf, "", true), /name invalid/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
