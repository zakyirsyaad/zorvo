import { describe, expect, it } from "vitest";
import {
  buildLoginRequest,
  buildNep413Payload,
  LOGIN_MESSAGE,
  LOGIN_RECIPIENT,
  nep413Digest,
  serializeNep413,
  type Signer,
} from "../scripts/nep413.mjs";

const NOW_MS = 1_800_000_123_456;

function bytes(length: number, fill: (index: number) => number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => fill(index));
}

function hex(data: Uint8Array): string {
  return [...data].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

describe("buildNep413Payload", () => {
  it("builds a 32-byte nonce: the time in milliseconds, big-endian, then the 24 random bytes", () => {
    // Arrange
    const random24 = bytes(24, (index) => 200 + index);

    // Act
    const payload = buildNep413Payload(NOW_MS, random24);

    // Assert
    expect(payload.nonce).toHaveLength(32);
    const head = new DataView(Uint8Array.from(payload.nonce.slice(0, 8)).buffer);
    expect(head.getBigUint64(0, false)).toBe(BigInt(NOW_MS));
    expect(payload.nonce.slice(8)).toEqual([...random24]);
  });

  it("asks for the recipient and the message NEAR AI checks", () => {
    const payload = buildNep413Payload(NOW_MS, new Uint8Array(24));

    expect(payload.recipient).toBe("cloud.near.ai");
    expect(payload.message).toBe("Sign in to NEAR AI Cloud");
    expect(LOGIN_RECIPIENT).toBe("cloud.near.ai");
    expect(LOGIN_MESSAGE).toBe("Sign in to NEAR AI Cloud");
  });

  it("refuses random bytes that are not 24 long and times that are not whole milliseconds", () => {
    expect(() => buildNep413Payload(NOW_MS, new Uint8Array(23))).toThrow(/24/);
    expect(() => buildNep413Payload(NOW_MS + 0.5, new Uint8Array(24))).toThrow(/time/);
    expect(() => buildNep413Payload(-1, new Uint8Array(24))).toThrow(/time/);
  });
});

describe("NEP-413 digest", () => {
  // Wallet fixtures from NEAR AI's own cloud-api test (crates/services/src/auth/near.rs, read 2026-11-07),
  // which it takes from the Sender and Meteor wallets and near-api-rs: SHA-256 of the 2^31 + 413 tag
  // followed by the borsh payload. They come from other implementations, so they are not our own output.
  const FIXTURE_NONCE = fromBase64("KNV0cOpvJ50D5vfF9pqWom8wo2sliQ4W+Wa7uZ3Uk6Y=");

  it("matches the wallet fixture without a callback URL", async () => {
    const digest = await nep413Digest({ message: "Hello NEAR!", nonce: FIXTURE_NONCE, recipient: "example.near", callbackUrl: null });

    expect(hex(digest)).toBe("036a114cfadb42200dc972aff40b994039571359cbcdd34be9c097d472351038");
  });

  it("matches the wallet fixture with a callback URL", async () => {
    const digest = await nep413Digest({
      message: "Hello NEAR!",
      nonce: FIXTURE_NONCE,
      recipient: "example.near",
      callbackUrl: "http://localhost:3000",
    });

    expect(hex(digest)).toBe("ca89aebc4b822cb0618aa785dca563acee228e2631cff9adb7ce44989c5e8874");
  });

  it("starts the signed bytes with the tag 2^31 + 413 as a little-endian u32", () => {
    const signed = serializeNep413({ message: "m", nonce: new Uint8Array(32), recipient: "r", callbackUrl: null });

    expect([...signed.slice(0, 4)]).toEqual([0x9d, 0x01, 0x00, 0x80]);
    // Then borsh: u32 length + bytes for each string, the nonce raw, and a 0 byte for no callback.
    expect(signed.length).toBe(4 + (4 + 1) + 32 + (4 + 1) + 1);
  });
});

/**
 * A throwaway Ed25519 key made here with WebCrypto, shaped as the signer the script builds around the
 * operator's NEAR key. (@near-js/crypto pulls in secp256k1, which the Workers runtime cannot load, so
 * the script wraps it and this test does not import it.) No real key is involved.
 */
async function throwawaySigner(): Promise<{ signer: Signer; verify: (data: Uint8Array, signature: Uint8Array) => Promise<boolean> }> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return {
    signer: {
      publicKey: `ed25519:test-${hex(raw)}`,
      sign: async (data) => new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, data)),
    },
    verify: (data, signature) => crypto.subtle.verify("Ed25519", pair.publicKey, signature, data),
  };
}

describe("buildLoginRequest", () => {
  it("signs the digest so the public key verifies it, and sends the shape NEAR AI reads", async () => {
    // Arrange
    const { signer, verify } = await throwawaySigner();
    const payload = buildNep413Payload(NOW_MS, bytes(24, (index) => index));

    // Act
    const request = await buildLoginRequest("operator.test", signer, payload);

    // Assert
    const { signed_message: signed } = request;
    expect(signed.accountId).toBe("operator.test");
    expect(signed.publicKey).toBe(signer.publicKey);
    const signature = fromBase64(signed.signature);
    expect(signature).toHaveLength(64);
    const digest = await nep413Digest({ ...payload, callbackUrl: null });
    expect(await verify(digest, signature)).toBe(true);
    expect(request.payload).toEqual({ ...payload, callbackUrl: null });
  });

  it("does not verify against a different payload", async () => {
    const { signer, verify } = await throwawaySigner();
    const request = await buildLoginRequest("operator.test", signer, buildNep413Payload(NOW_MS, new Uint8Array(24)));

    const other = await nep413Digest({ ...buildNep413Payload(NOW_MS + 1, new Uint8Array(24)), callbackUrl: null });

    expect(await verify(other, fromBase64(request.signed_message.signature))).toBe(false);
  });
});
