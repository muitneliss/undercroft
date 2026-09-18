import { describe, expect, test } from "bun:test";
import { currentKeyVersion, SecretKeyMissing, seal, unseal } from "./seal.ts";
import { createPkce, hashToken, tokenMatches } from "./tokens.ts";

// A fresh 32-byte key, base64. Two versions for rotation tests.
const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const KEY_V2 = Buffer.alloc(32, 2).toString("base64");

function env(value: string): NodeJS.ProcessEnv {
  return { UNDERCROFT_SECRET_KEY: value };
}

describe("seal and unseal round-trip", () => {
  test("opens what it sealed", () => {
    const e = env(KEY_V1);
    const sealed = seal("refresh-token-abc", { env: e });
    expect(unseal(sealed, e)).toBe("refresh-token-abc");
  });

  test("a fresh nonce means two seals of the same value differ", () => {
    const e = env(KEY_V1);
    const a = seal("same", { env: e });
    const b = seal("same", { env: e });
    expect(Buffer.from(a.blob).equals(Buffer.from(b.blob))).toBe(false);
    expect(unseal(a, e)).toBe(unseal(b, e));
  });
});

describe("tampering is caught, never opened as empty", () => {
  test("a flipped ciphertext bit throws rather than returning a value", () => {
    // The rule in one assertion: a credential that silently opens as "" would present as
    // a connection that exists and does not work -- the slowest failure to diagnose.
    const e = env(KEY_V1);
    const sealed = seal("secret", { env: e });
    const tampered = Buffer.from(sealed.blob);
    const last = tampered.byteLength - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x01; // flip a tag bit
    expect(() => unseal({ blob: tampered, keyVersion: sealed.keyVersion }, e)).toThrow();
  });

  test("a truncated blob throws", () => {
    const e = env(KEY_V1);
    expect(() => unseal({ blob: new Uint8Array(4), keyVersion: 1 }, e)).toThrow(/truncated/u);
  });
});

describe("additive key rotation", () => {
  test("new values seal under the highest version", () => {
    const e = env(`1:${KEY_V1},2:${KEY_V2}`);
    expect(currentKeyVersion(e)).toBe(2);
    expect(seal("x", { env: e }).keyVersion).toBe(2);
  });

  test("a value sealed under an old key still opens after a new key is added", () => {
    const oldOnly = env(`1:${KEY_V1}`);
    const sealed = seal("legacy", { env: oldOnly });

    const both = env(`1:${KEY_V1},2:${KEY_V2}`);
    expect(unseal(sealed, both)).toBe("legacy");
  });

  test("opening a value whose key was rotated out is a clear error, not a guess", () => {
    const sealed = seal("x", { env: env(`1:${KEY_V1}`) });
    expect(() => unseal(sealed, env(`2:${KEY_V2}`))).toThrow(SecretKeyMissing);
  });
});

describe("a short key is refused, never stretched", () => {
  test("rejects a 16-byte key rather than padding it to 32", () => {
    const short = Buffer.alloc(16, 9).toString("base64");
    expect(() => seal("x", { env: env(short) })).toThrow(/32 bytes/u);
  });

  test("rejects a missing key eagerly", () => {
    expect(() => seal("x", { env: {} })).toThrow(SecretKeyMissing);
  });
});

describe("token hashing", () => {
  test("a token matches its own stored digest and nothing else", () => {
    const digest = hashToken("uc_live_secret");
    expect(tokenMatches("uc_live_secret", digest)).toBe(true);
    expect(tokenMatches("wrong", digest)).toBe(false);
  });

  test("the digest is not the token", () => {
    expect(hashToken("token")).not.toBe("token");
  });
});

describe("PKCE", () => {
  test("produces an S256 challenge that verifies against its verifier", () => {
    const { verifier, challenge, method } = createPkce();
    expect(method).toBe("S256");
    const recomputed = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
    expect(recomputed).toBe(challenge);
  });
});
