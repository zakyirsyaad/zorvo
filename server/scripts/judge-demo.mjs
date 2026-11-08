// Verifies one private NEAR AI answer without a Mac: register a fresh device, redeem the judge
// code, take the one-time key, send one non-streamed completion, and check NEAR AI's signature and
// attestation. The judge code, the device secret and the key are never printed or put in a URL.
//
//   node server/scripts/judge-demo.mjs <worker-url> <judge-code>
//   ZORVO_JUDGE_URL=... ZORVO_JUDGE_CODE=... node server/scripts/judge-demo.mjs
//
// Only the short report goes to stdout; progress and failures go to stderr.

import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const NEAR_AI_URL = "https://cloud-api.near.ai/v1";
const MODEL = "Qwen/Qwen3.8-27B-abliterated";
const TOPUP_POLL_MS = 3_000;
const TOPUP_WAIT_MS = 120_000;
const SIGNATURE_TRIES = 3;
const SIGNATURE_RETRY_MS = 3_000;

/** Hex SHA-256 of exact bytes. @param {Uint8Array} bytes @returns {string} */
export function sha256Hex(bytes) {
  return bytesToHex(sha256(bytes));
}

/** @param {string} text @returns {Uint8Array} */
function bytesOf(text) {
  return new TextEncoder().encode(text);
}

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} address @returns {string} */
export function normalizeAddress(address) {
  return `0x${address.replace(/^0x/i, "").toLowerCase()}`;
}

/**
 * Whether the signed text binds the exact hashes: the model binds a provider-TEE answer, while a
 * gateway signature binds only the two hashes. @param {string} kind @param {string} text
 * @param {string} model @param {string} requestSha @param {string} responseSha
 * @returns {boolean}
 */
export function signedTextMatches(kind, text, model, requestSha, responseSha) {
  const provider = `${model}:${requestSha}:${responseSha}`;
  const gateway = `${requestSha}:${responseSha}`;
  if (kind === "provider_tee") return text === provider;
  if (kind === "gateway") return text === gateway;
  return text === provider || text === gateway;
}

/**
 * The EIP-191 digest of `text`, as personal_sign makes it. @param {string} text
 * @returns {Uint8Array}
 */
export function eip191Digest(text) {
  const prefix = bytesOf(`\x19Ethereum Signed Message:\n${bytesOf(text).length}`);
  return keccak_256(new Uint8Array([...prefix, ...bytesOf(text)]));
}

/**
 * The checksum-less address a 65-byte ECDSA signature recovers for `text`. @param {string} text
 * @param {string} signatureHex @returns {string | null}
 */
export function recoverAddress(text, signatureHex) {
  try {
    const bytes = hexToBytes(signatureHex.replace(/^0x/i, ""));
    if (bytes.length !== 65) return null;
    const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
    if (recovery !== 0 && recovery !== 1) return null;
    const signature = secp256k1.Signature.fromCompact(bytes.slice(0, 64)).addRecoveryBit(recovery);
    const publicKey = signature.recoverPublicKey(eip191Digest(text));
    const hash = keccak_256(publicKey.toRawBytes(false).slice(1));
    return `0x${bytesToHex(hash.slice(-20))}`;
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The signers NEAR AI's report names for this nonce, in the fields the app's verifier accepts.
 * @param {unknown} report @param {string} nonce
 * @returns {{ modelSigners: Set<string>, gatewaySigner: string | null }}
 */
export function parseAttestation(report, nonce) {
  /** @type {Set<string>} */
  const modelSigners = new Set();
  if (isObject(report) && Array.isArray(report.model_attestations)) {
    for (const model of report.model_attestations) {
      if (isObject(model) && model.request_nonce === nonce && typeof model.signing_address === "string") {
        modelSigners.add(normalizeAddress(model.signing_address));
      }
    }
  }
  let gatewaySigner = null;
  if (isObject(report)) {
    for (const key of ["gateway_attestation", "gateway"]) {
      const gateway = report[key];
      if (isObject(gateway) && typeof gateway.signing_address === "string") {
        gatewaySigner = normalizeAddress(gateway.signing_address);
        break;
      }
    }
    if (gatewaySigner === null && Array.isArray(report.gateway_attestations)) {
      const first = report.gateway_attestations[0];
      if (isObject(first) && typeof first.signing_address === "string") {
        gatewaySigner = normalizeAddress(first.signing_address);
      }
    }
    if (gatewaySigner === null && typeof report.gateway_signing_address === "string") {
      gatewaySigner = normalizeAddress(report.gateway_signing_address);
    }
  }
  return { modelSigners, gatewaySigner };
}

/** @param {ReturnType<typeof parseAttestation>} attestation @param {string} kind @param {string} signer */
export function attestationAllows(attestation, kind, signer) {
  if (kind === "provider_tee") return attestation.modelSigners.has(signer);
  if (kind === "gateway") return attestation.gatewaySigner === signer;
  return attestation.modelSigners.has(signer) || attestation.gatewaySigner === signer;
}

/** @param {string} url @param {RequestInit & { token?: string, body?: string }} options */
async function jsonRequest(url, { token, body, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, body });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  /** @type {unknown} */
  let parsed = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    // A non-JSON answer is reported by status below, never by its body.
  }
  return { response, parsed, bytes };
}

/** @param {string} worker @param {string} path @param {string} [token] @param {unknown} [body] */
async function workerJson(worker, path, token, body) {
  const { response, parsed } = await jsonRequest(`${worker}${path}`, {
    method: body === undefined ? "GET" : "POST",
    token,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return parsed;
}

/** @param {string} worker @param {string} code */
async function redeem(worker, code) {
  const secret = bytesToHex(randomBytes(32));
  const device = await workerJson(worker, "/v1/devices", undefined, {
    secretHash: sha256Hex(bytesOf(secret)),
  });
  if (!isObject(device) || typeof device.deviceId !== "string") throw new Error("device registration had no id");
  const promo = await workerJson(worker, "/v1/promo", secret, { code });
  if (!isObject(promo) || typeof promo.topupId !== "string") throw new Error("promo produced no top-up");
  const deadline = Date.now() + TOPUP_WAIT_MS;
  for (;;) {
    const topup = await workerJson(worker, `/v1/topups/${encodeURIComponent(promo.topupId)}`, secret);
    if (!isObject(topup)) throw new Error("top-up status was unreadable");
    if (topup.status === "credited") break;
    if (topup.status === "failed" || topup.status === "expired") {
      throw new Error(`the judge top-up ended ${topup.status}`);
    }
    if (Date.now() >= deadline) throw new Error("the judge top-up did not reach credited in time");
    await sleep(TOPUP_POLL_MS);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const answer = await workerJson(worker, "/v1/key", secret);
    if (isObject(answer) && typeof answer.key === "string" && answer.key !== "") return answer.key;
    if (attempt < 4) await sleep(1_000);
  }
  throw new Error("the credited device had no key");
}

/**
 * @typedef {{ text: string, signature: string, signing_address: string, signature_kind?: string }} Proof
 */

/** @param {string} key @param {string} id @param {string} model @returns {Promise<Proof>} */
async function signature(key, id, model) {
  for (let attempt = 0; attempt < SIGNATURE_TRIES; attempt += 1) {
    const url = new URL(`${NEAR_AI_URL}/signature/${encodeURIComponent(id)}`);
    url.searchParams.set("model", model);
    url.searchParams.set("signing_algo", "ecdsa");
    const { response, parsed } = await jsonRequest(url.href, { token: key });
    if (response.status === 404) {
      if (attempt + 1 < SIGNATURE_TRIES) await sleep(SIGNATURE_RETRY_MS);
      continue;
    }
    if (!response.ok) throw new Error(`signature answered ${response.status}`);
    if (
      !isObject(parsed) ||
      (parsed.error_code !== undefined && parsed.error_code !== null) ||
      typeof parsed.text !== "string" ||
      typeof parsed.signature !== "string" ||
      typeof parsed.signing_address !== "string"
    ) {
      if (attempt + 1 < SIGNATURE_TRIES) {
        await sleep(SIGNATURE_RETRY_MS);
        continue;
      }
      throw new Error("signature was not available");
    }
    return /** @type {Proof} */ (parsed);
  }
  throw new Error("signature was not found");
}

/** @param {string} key @param {string} model */
async function attestation(key, model) {
  const nonce = bytesToHex(randomBytes(32));
  const url = new URL(`${NEAR_AI_URL}/attestation/report`);
  url.searchParams.set("model", model);
  url.searchParams.set("signing_algo", "ecdsa");
  url.searchParams.set("nonce", nonce);
  const { response, parsed } = await jsonRequest(url.href, { token: key });
  if (!response.ok) throw new Error(`attestation answered ${response.status}`);
  return { nonce, report: parseAttestation(parsed, nonce) };
}

/** @param {string} worker @param {string} code */
async function run(worker, code) {
  const key = await redeem(worker, code);
  const chat = {
    model: MODEL,
    messages: [{ role: "user", content: "Reply with the single word: ready." }],
    stream: false,
    max_tokens: 16,
    temperature: 0,
  };
  const requestText = JSON.stringify(chat);
  const requestSha = sha256Hex(bytesOf(requestText));
  const { response, parsed, bytes: responseBytes } = await jsonRequest(`${NEAR_AI_URL}/chat/completions`, {
    method: "POST",
    token: key,
    body: requestText,
    headers: { "accept-encoding": "identity", "x-no-aliasing": "true" },
  });
  if (!response.ok) throw new Error(`chat answered ${response.status}`);
  if (!isObject(parsed) || typeof parsed.id !== "string" || parsed.id === "") {
    throw new Error("chat answer had no completion id");
  }
  // The app's verifier binds the model it requested; x-no-aliasing keeps NEAR AI from answering another.
  const model = MODEL;
  const responseSha = sha256Hex(responseBytes);
  const proof = await signature(key, parsed.id, model);
  const kind =
    proof.signature_kind === "provider_tee" || proof.signature_kind === "gateway"
      ? proof.signature_kind
      : "unknown";
  const signer = normalizeAddress(proof.signing_address);
  if (!signedTextMatches(kind, proof.text, model, requestSha, responseSha)) {
    throw new Error("the signed text does not match the exact request and response");
  }
  const recovered = recoverAddress(proof.text, proof.signature);
  if (recovered === null || recovered !== signer) {
    throw new Error("the EIP-191 signer does not match NEAR AI's signing address");
  }
  const check = await attestation(key, model);
  if (!attestationAllows(check.report, kind, signer)) {
    throw new Error("the signer is not in NEAR AI's attestation report for this nonce");
  }
  console.log(`Model: ${model}`);
  console.log(`Kind: ${kind}`);
  console.log(`Signer: ${signer}`);
  console.log("Verified: NEAR AI signed the exact request and response, and its attestation names the signer.");
}

/** @returns {boolean} */
function isMain() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const worker = process.argv[2] ?? process.env.ZORVO_JUDGE_URL ?? "";
  const code = process.argv[3] ?? process.env.ZORVO_JUDGE_CODE ?? "";
  const workerUrl = (() => {
    try {
      const parsed = new URL(worker);
      if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return null;
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
      return parsed.href.replace(/\/+$/, "");
    } catch {
      return null;
    }
  })();
  if (workerUrl === null || code === "") {
    console.error("Usage: node server/scripts/judge-demo.mjs <worker-url> <judge-code>");
    process.exitCode = 2;
  } else {
    run(workerUrl, code).catch((error) => {
      console.error(`Not verified: ${error instanceof Error ? error.message : "the check failed"}`);
      process.exitCode = 1;
    });
  }
}