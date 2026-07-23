import assert from "node:assert/strict";
import test from "node:test";

import { getFile, listChildren, putFile } from "../src/webdav.js";

test("WebDAV listing accepts arbitrary XML namespace prefixes", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<?xml version="1.0"?>
    <x:multistatus xmlns:x="DAV:">
      <x:response><x:href>/Music/Library/Artist/</x:href>
        <x:propstat><x:prop><x:resourcetype><x:collection/></x:resourcetype>
        </x:prop></x:propstat></x:response>
      <x:response><x:href>/Music/Library/Artist/Album/</x:href>
        <x:propstat><x:prop><x:resourcetype><x:collection/></x:resourcetype>
        </x:prop></x:propstat></x:response>
      <x:response><x:href>/Music/Library/Artist/01.flac</x:href>
        <x:propstat><x:prop><x:resourcetype/>
        <x:getcontentlength>1234</x:getcontentlength>
        </x:prop></x:propstat></x:response>
    </x:multistatus>`, { status: 207 });
  try {
    const children = await listChildren({
      baseUrl: "https://dav.example/", username: "u", password: "p",
    }, "Music/Library/Artist");
    assert.deepEqual(children, [
      { name: "Album", size: 0, file: null, folder: {} },
      { name: "01.flac", size: 1234, file: {}, folder: null },
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("WebDAV listing does not mistake a same-named child for the folder itself", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<?xml version="1.0"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/Music/Library/Artist/</d:href>
        <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype>
        </d:prop></d:propstat></d:response>
      <d:response><d:href>/Music/Library/Artist/Artist/</d:href>
        <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype>
        </d:prop></d:propstat></d:response>
    </d:multistatus>`, { status: 207 });
  try {
    const children = await listChildren({
      baseUrl: "https://dav.example/", username: "u", password: "p",
    }, "Music/Library/Artist");
    assert.deepEqual(children, [
      { name: "Artist", size: 0, file: null, folder: {} },
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("strict WebDAV listing reports upstream failures for migrations", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    const conf = {
      baseUrl: "https://dav.example/", username: "u", password: "p",
    };
    assert.deepEqual(await listChildren(conf, "Music/Library/Artist"), []);
    await assert.rejects(
      listChildren(conf, "Music/Library/Artist", true), /PROPFIND 503/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("WebDAV listing bounds oversized PROPFIND responses", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("too large", {
    status: 207,
    headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
  });
  try {
    const conf = { baseUrl: "https://dav.example.com/", username: "u", password: "p" };
    assert.deepEqual(await listChildren(conf, "Music/Library/Artist"), []);
    await assert.rejects(
      listChildren(conf, "Music/Library/Artist", true), /exceeds/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("strict WebDAV listing rejects malformed hrefs instead of skipping files", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<?xml version="1.0"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/Music/Library/Artist/%ZZ</d:href>
        <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat>
      </d:response>
    </d:multistatus>`, { status: 207 });
  try {
    const conf = { baseUrl: "https://dav.example/", username: "u", password: "p" };
    assert.deepEqual(await listChildren(conf, "Music/Library/Artist"), []);
    await assert.rejects(
      listChildren(conf, "Music/Library/Artist", true), /invalid href/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("WebDAV listing skips or rejects unsafe child names", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<?xml version="1.0"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/Music/Library/Artist/%2e%2e/</d:href>
        <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat>
      </d:response>
    </d:multistatus>`, { status: 207 });
  try {
    const conf = { baseUrl: "https://dav.example/", username: "u", password: "p" };
    assert.deepEqual(await listChildren(conf, "Music/Library/Artist"), []);
    await assert.rejects(
      listChildren(conf, "Music/Library/Artist", true), /unsafe child name/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("WebDAV proxy uploads forward a stream without array-buffering it", async () => {
  const realFetch = globalThis.fetch;
  let received = "";
  globalThis.fetch = async (_input, init) => {
    received = await new Response(init.body).text();
    return new Response(null, { status: 201 });
  };
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("streamed-audio"));
      controller.close();
    },
  });
  try {
    assert.equal(await putFile({
      baseUrl: "https://dav.example/", username: "u", password: "p",
    }, "track.flac", body, "audio/flac"), true);
    assert.equal(received, "streamed-audio");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("WebDAV preserves an unsatisfiable range response", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 416, headers: { "Content-Range": "bytes */100" },
  });
  try {
    const response = await getFile({
      baseUrl: "https://dav.example/", username: "u", password: "p",
    }, "track.flac", "bytes=200-");
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */100");
  } finally {
    globalThis.fetch = realFetch;
  }
});
