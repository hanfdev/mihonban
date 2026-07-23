import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, sessionCookie, verifyPassword } from "../src/auth.js";

test("password hashes round-trip and reject a wrong password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("malformed password hashes fail closed without throwing", async () => {
  const malformed = [
    "", "pbkdf2", "pbkdf2$nope$00$00",
    "pbkdf2$999999999$00000000000000000000000000000000$" + "00".repeat(32),
    "pbkdf2$210000$not-hex$" + "00".repeat(32),
  ];
  for (const hash of malformed) {
    assert.equal(await verifyPassword("anything", hash), false, hash);
  }
});

test("session cookies fail closed without a sufficiently strong secret", async () => {
  const env = {
    SESSION_SECRET: "too-short",
    DB: {
      prepare() {
        return { bind() { return { first: async () => null }; } };
      },
    },
  };
  await assert.rejects(
    sessionCookie(env, "admin"),
    /SESSION_SECRET must contain at least 32 characters/,
  );
});
