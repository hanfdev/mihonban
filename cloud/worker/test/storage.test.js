import assert from "node:assert/strict";
import test from "node:test";

import { clearStorageCache, loadStorage } from "../src/storage.js";

function fakeEnv(kind) {
  const DB = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ kind, config: JSON.stringify({ marker: kind }) }),
      }),
    }),
  };
  return { DB };
}

test("storage config cache is isolated per database binding", async () => {
  clearStorageCache();
  const first = await loadStorage(fakeEnv("onedrive"), "shared-id");
  const second = await loadStorage(fakeEnv("webdav"), "shared-id");
  assert.equal(first.kind, "onedrive");
  assert.equal(second.kind, "webdav");
});
