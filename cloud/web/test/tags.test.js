import assert from "node:assert/strict";
import test from "node:test";

import {
  audioFileFormat, normalizedAudioFilename, readTags, recognizedAudioFiles,
} from "../src/tags.js";
import { creditsFromTags } from "../src/artist-credit.js";

function namedBlob(name, bytes, type = "") {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}

test("Windows 8.3 FLAC aliases are recognized by signature", async () => {
  const file = namedBlob("01-MIC~1.FLA", [
    0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22,
  ]);
  assert.equal(await audioFileFormat(file), "flac");
  assert.equal(normalizedAudioFilename(file.name, "flac"), "01-MIC~1.flac");
  assert.deepEqual(await recognizedAudioFiles([file]), [{ file, format: "flac" }]);
});

test("a non-audio FLA file is never accepted as FLAC", async () => {
  const file = namedBlob("animation.FLA", [0x46, 0x57, 0x53, 0x09]);
  assert.equal(await audioFileFormat(file), "");
  assert.deepEqual(await recognizedAudioFiles([file]), []);
});

test("known audio extensions remain available without signature probing", async () => {
  const file = namedBlob("track.flac", [0x00]);
  assert.equal(await audioFileFormat(file), "flac");
  assert.equal(normalizedAudioFilename(file.name, "flac"), "track.flac");
});

test("FLAC ARTISTS metadata imports semicolon-separated names as individual credits", async () => {
  const names = ["Elis Regina", "Luiz Cláudio Ramos", "Luizão Maia",
    "Wilson das Neves", "José Roberto Bertrami", "Hermes Contesini"];
  const tags = ["TITLE=Test Song", "ALBUMARTIST=Elis Regina",
    `ARTIST=${names.join('; ')}`, `ARTISTS=${names.join('; ')}`];
  const uint32 = (n) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(n);
    return buffer;
  };
  const comments = Buffer.concat([uint32(0), uint32(tags.length), ...tags.flatMap((tag) => {
    const value = Buffer.from(tag, "utf8");
    return [uint32(value.length), value];
  })]);
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeUInt16BE(4096, 0);
  streamInfo.writeUInt16BE(4096, 2);
  streamInfo.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | 44100n, 10);
  const commentHeader = Buffer.alloc(4);
  commentHeader[0] = 0x84;
  commentHeader.writeUIntBE(comments.length, 1, 3);
  const file = namedBlob("01.flac", Buffer.concat([
    Buffer.from("fLaC"), Buffer.from([0, 0, 0, 34]), streamInfo, commentHeader, comments,
  ]), "audio/flac");
  const metadata = await readTags(file);
  assert.equal(metadata.title, "Test Song");
  assert.equal(metadata.hasStructuredArtists, true);
  assert.equal(metadata.albumArtist, "Elis Regina");
  assert.deepEqual(creditsFromTags(metadata), names.map((name) => ({ name, sort: "" })));
});
