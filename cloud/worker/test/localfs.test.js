import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as localfs from "../src/localfs.js";

test("local storage maps, writes, lists, ranges, and deletes safely", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mihonban-localfs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const conf = { root, odRoot: "Music/Library" };
  const path = "Music/Library/Artist/Album/track.bin";
  const bytes = new TextEncoder().encode("0123456789");

  assert.equal(localfs.mapPath(conf, path), "Artist/Album/track.bin");
  assert.equal(await localfs.putSmallFile(conf, path, bytes), true);
  assert.equal(await readFile(join(root, "Artist", "Album", "track.bin"), "utf8"),
    "0123456789");

  const streamed = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("stream-"));
      controller.enqueue(new TextEncoder().encode("upload"));
      controller.close();
    },
  });
  assert.equal(await localfs.putFile(conf, path, streamed), true);
  assert.equal(await readFile(join(root, "Artist", "Album", "track.bin"), "utf8"),
    "stream-upload");

  const children = await localfs.listChildren(conf, "Music/Library/Artist/Album");
  assert.deepEqual(children.map((x) => x.name), ["track.bin"]);

  const full = await localfs.getFile(conf, path);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), "stream-upload");

  const suffix = await localfs.getFile(conf, path, "bytes=-4");
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("Content-Range"), "bytes 9-12/13");
  assert.equal(await suffix.text(), "load");

  const invalid = await localfs.getFile(conf, path, "bytes=20-30");
  assert.equal(invalid.status, 416);
  const malformedRange = await localfs.getFile(conf, path, "bytes=0-1,3-4");
  assert.equal(malformedRange.status, 416);

  const emptyPath = "Music/Library/Artist/Album/empty.bin";
  assert.equal(await localfs.putSmallFile(
    conf, emptyPath, new Uint8Array()), true);
  const empty = await localfs.getFile(conf, emptyPath);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("Content-Length"), "0");
  assert.equal((await empty.arrayBuffer()).byteLength, 0);
  const emptyRange = await localfs.getFile(conf, emptyPath, "bytes=0-0");
  assert.equal(emptyRange.status, 416);
  assert.equal(emptyRange.headers.get("Content-Range"), "bytes */0");

  assert.equal(await localfs.deleteItem(conf, path), true);
  assert.equal(await localfs.deleteItem(conf, emptyPath), true);
  assert.deepEqual(await localfs.listChildren(conf, "Music/Library/Artist/Album"), []);
});

test("local storage connectivity test never overwrites a user file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mihonban-localfs-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sentinel = join(root, ".mihonban-write-test");
  await writeFile(sentinel, "keep-me");

  assert.deepEqual(await localfs.test({ root }), {
    ok: true, owner: root, used: 0, total: 0,
  });
  assert.equal(await readFile(sentinel, "utf8"), "keep-me");
  assert.deepEqual((await readdir(root)).sort(), [".mihonban-write-test"]);
});

test("local storage rejects missing roots and traversal", async () => {
  await assert.rejects(() => localfs.putSmallFile({}, "x", new Uint8Array()),
    /root/);
  const root = await mkdtemp(join(tmpdir(), "mihonban-localfs-"));
  try {
    await assert.rejects(
      () => localfs.putSmallFile({ root }, "../escape", new Uint8Array()),
      /越界/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local storage rejects a symlink or junction that escapes its root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mihonban-localfs-root-"));
  const outside = await mkdtemp(join(tmpdir(), "mihonban-localfs-outside-"));
  try {
    try {
      await symlink(outside, join(root, "escape"),
        process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        t.skip(`symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      () => localfs.putSmallFile(
        { root, odRoot: "Music/Library" },
        "Music/Library/escape/outside.bin", new Uint8Array([1])),
      /越界/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
