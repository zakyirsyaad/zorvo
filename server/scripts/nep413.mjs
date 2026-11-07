// The pure part of the operator login (see operator-login.mjs): building, serializing, hashing and
// signing a NEP-413 sign-in payload for NEAR AI Cloud. It has no Node-only imports (no node:fs, no
// process), so the Workers-pool test can import it. The key file and the network stay in the CLI.
//
// What NEAR AI Cloud expects was read on 2026-11-07 from its public source,
// https://github.com/nearai/cloud-api:
// - crates/api/src/routes/auth.rs: `POST /v1/auth/near` takes
//   `{ signed_message: { accountId, publicKey, signature }, payload: { message, nonce, recipient, callbackUrl } }`
//   (camelCase inside both objects). `signature` is BASE64 (64 bytes for ed25519), `nonce` is a JSON
//   array of exactly 32 numbers, `callbackUrl` is optional. A User-Agent header is required (else 400).
//   The answer is `{ access_token, refresh_token, refresh_token_expiration, user }`.
// - crates/services/src/auth/near.rs: message must be "Sign in to NEAR AI Cloud"; the recipient must equal
//   its NEAR_EXPECTED_RECIPIENT (env.example: "cloud.near.ai"); the first 8 bytes of the nonce are a
//   big-endian millisecond timestamp, accepted within 5 minutes and not in the future; the signature is
//   checked against a FULL-ACCESS key of the account (`require_full_access: true`); a nonce works once.
//   Its unit test pins the NEP-413 hash to wallet fixtures, which test/operator-login.test.ts reuses.

import { serialize } from "borsh";

export const LOGIN_MESSAGE = "Sign in to NEAR AI Cloud";
export const LOGIN_RECIPIENT = "cloud.near.ai";

const TIMESTAMP_BYTES = 8;
const RANDOM_BYTES = 24;
const NONCE_BYTES = TIMESTAMP_BYTES + RANDOM_BYTES;
/** NEP-413: the signed bytes start with the tag 2^31 + 413 as a little-endian u32. */
const NEP413_TAG = 2 ** 31 + 413;

const PAYLOAD_SCHEMA = {
  struct: {
    message: "string",
    nonce: { array: { type: "u8", len: NONCE_BYTES } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
};

/**
 * @typedef {{ message: string, nonce: number[] | Uint8Array, recipient: string, callbackUrl: string | null }} Nep413Payload
 * @typedef {{ publicKey: string, sign: (digest: Uint8Array) => Uint8Array | Promise<Uint8Array> }} Signer
 *   The operator's key as the CLI wraps it: `publicKey` is "ed25519:<base58>", `sign` signs the digest as it is.
 */

/**
 * The payload to sign: a nonce of the time (8 bytes, big-endian milliseconds) and 24 random bytes.
 * @param {number} nowMs
 * @param {Uint8Array} random24
 * @returns {{ message: string, nonce: number[], recipient: "cloud.near.ai" }}
 */
export function buildNep413Payload(nowMs, random24) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("The time must be a positive whole number of milliseconds");
  if (random24.length !== RANDOM_BYTES) throw new Error(`Expected ${RANDOM_BYTES} random bytes, got ${random24.length}`);
  const nonce = new Uint8Array(NONCE_BYTES);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(nowMs), false);
  nonce.set(random24, TIMESTAMP_BYTES);
  return { message: LOGIN_MESSAGE, nonce: [...nonce], recipient: LOGIN_RECIPIENT };
}

/**
 * The bytes that are hashed: the tag, then the borsh payload.
 * @param {Nep413Payload} payload
 * @returns {Uint8Array}
 */
export function serializeNep413(payload) {
  const body = serialize(PAYLOAD_SCHEMA, { ...payload, nonce: [...payload.nonce] });
  const bytes = new Uint8Array(4 + body.length);
  new DataView(bytes.buffer).setUint32(0, NEP413_TAG, true);
  bytes.set(body, 4);
  return bytes;
}

/**
 * SHA-256 of the signed bytes; this digest is what the ed25519 key signs.
 * @param {Nep413Payload} payload
 * @returns {Promise<Uint8Array>}
 */
export async function nep413Digest(payload) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", serializeNep413(payload)));
}

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The body for `POST /v1/auth/near`.
 * @param {string} accountId
 * @param {Signer} signer
 * @param {{ message: string, nonce: number[], recipient: string }} payload
 */
export async function buildLoginRequest(accountId, signer, payload) {
  const full = { ...payload, callbackUrl: null };
  const signature = await signer.sign(await nep413Digest(full));
  return {
    signed_message: { accountId, publicKey: signer.publicKey, signature: toBase64(signature) },
    payload: full,
  };
}
