import assert from "node:assert/strict";
import test from "node:test";

import {
  audioFileFormat, normalizedAudioFilename, recognizedAudioFiles,
} from "../src/tags.js";

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
