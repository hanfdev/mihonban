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

test("session cookies use the current product namespace", async () => {
  const env = {
    SESSION_SECRET: "x".repeat(32),
    DEV_INSECURE_COOKIE: "1",
    DB: {
      prepare() {
        return { bind() { return { first: async () => null }; } };
      },
    },
  };
  const cookie = await sessionCookie(env, "admin");
  assert.match(cookie, /^mihonban_session=/);
});

test("only DEV_INSECURE_COOKIE=1 drops the Secure attribute", async () => {
  const envWith = (value) => ({
    SESSION_SECRET: "x".repeat(32),
    ...(value === undefined ? {} : { DEV_INSECURE_COOKIE: value }),
    DB: {
      prepare() {
        return { bind() { return { first: async () => null }; } };
      },
    },
  });
  // "0", "false", and an empty string are not explicit enablement. Environment
  // variables are always strings, so a truthiness check would misclassify them.
  for (const value of [undefined, "", "0", "false", "no"]) {
    const cookie = await sessionCookie(envWith(value), "admin");
    assert.match(cookie, / Secure;/, `value=${JSON.stringify(value)}`);
  }
  assert.doesNotMatch(await sessionCookie(envWith("1"), "admin"), / Secure;/);
});
