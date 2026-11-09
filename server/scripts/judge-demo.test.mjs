// The judge script's pure checks on Node (`node --test`): the hashes, the signed text, EIP-191
// recovery with throwaway keys made here, the attestation fields, and the usage message. Nothing
// here reaches the Worker or NEAR AI.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import {
  attestationAllows,
  eip191Digest,
  lacksJudgeModel,
  normalizeAddress,
  parseAttestation,
  recoverAddress,
  sha256Hex,
  signedTextMatches,
} from "./judge-demo.mjs";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("./judge-demo.mjs", import.meta.url));

/** @param {string} text @returns {Uint8Array} */
function utf8(text) {
  return new TextEncoder().encode(text);
}

/** A throwaway secp256k1 key and its checksum-less address. */
function testWallet() {
  let privateKey = randomBytes(32);
  while (!secp256k1.utils.isValidPrivateKey(privateKey)) privateKey = randomBytes(32);
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return { privateKey, address: `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}` };
}

/**
 * The 65-byte signature of `text` in the layout NEAR AI sends: compact r||s, then the recovery
 * byte, either 0/1 or the legacy 27/28.
 * @param {string} text @param {Uint8Array} privateKey @param {boolean} [legacyV]
 * @returns {string}
 */
function signText(text, privateKey, legacyV = false) {
  const signature = secp256k1.sign(eip191Digest(text), privateKey);
  const recovery = legacyV ? signature.recovery + 27 : signature.recovery;
  return `0x${bytesToHex(signature.toCompactRawBytes())}${recovery.toString(16).padStart(2, "0")}`;
}

describe("hashing the exact bytes", () => {
  it("hashes UTF-8 text with SHA-256", () => {
    assert.equal(sha256Hex(utf8("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes empty bytes to the empty SHA-256", () => {
    assert.equal(sha256Hex(new Uint8Array()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("distinguishes two byte sequences a text decoder would join", () => {
    assert.notEqual(sha256Hex(utf8("é")), sha256Hex(utf8("e\u0301")));
  });
});

describe("the signed text", () => {
  const model = "Qwen/Qwen3.8-27B-abliterated";
  const requestSha = "a".repeat(64);
  const responseSha = "b".repeat(64);
  const provider = `${model}:${requestSha}:${responseSha}`;
  const gateway = `${requestSha}:${responseSha}`;

  it("makes a provider-TEE answer name the model and both hashes", () => {
    assert.equal(signedTextMatches("provider_tee", provider, model, requestSha, responseSha), true);
    assert.equal(signedTextMatches("provider_tee", gateway, model, requestSha, responseSha), false);
    assert.equal(
      signedTextMatches("provider_tee", `${model}:${responseSha}:${requestSha}`, model, requestSha, responseSha),
      false,
    );
  });

  it("makes a gateway answer name only the two hashes", () => {
    assert.equal(signedTextMatches("gateway", gateway, model, requestSha, responseSha), true);
    assert.equal(signedTextMatches("gateway", provider, model, requestSha, responseSha), false);
  });

  it("accepts either form when NEAR AI names no kind", () => {
    assert.equal(signedTextMatches("unknown", provider, model, requestSha, responseSha), true);
    assert.equal(signedTextMatches("unknown", gateway, model, requestSha, responseSha), true);
    assert.equal(signedTextMatches("unknown", requestSha, model, requestSha, responseSha), false);
  });
});

describe("the EIP-191 digest", () => {
  it("matches the published personal_sign hash of Hello World", () => {
    assert.equal(
      bytesToHex(eip191Digest("Hello World")),
      "a1de988600a42c4b4ab089b619297c17d53cffae5d5120d82d8a92d0bb3b78f2",
    );
  });

  it("counts UTF-8 bytes, not JavaScript characters", () => {
    const prefix = utf8(`\x19Ethereum Signed Message:\n${utf8("é").length}`);
    assert.equal(bytesToHex(eip191Digest("é")), bytesToHex(keccak_256(new Uint8Array([...prefix, ...utf8("é")]))));
  });
});

describe("recovering the signer", () => {
  it("recovers the address of the key that signed the text", () => {
    const wallet = testWallet();
    assert.equal(recoverAddress("the exact request and response", signText("the exact request and response", wallet.privateKey)), wallet.address);
  });

  it("accepts a legacy 27/28 recovery byte", () => {
    const wallet = testWallet();
    const signature = signText("legacy recovery", wallet.privateKey, true);
    assert.equal(recoverAddress("legacy recovery", signature), wallet.address);
  });

  it("recovers another address for other text", () => {
    const wallet = testWallet();
    const signature = signText("the signed text", wallet.privateKey);
    assert.notEqual(recoverAddress("different text", signature), wallet.address);
  });

  it("answers null for a signature that is not a 65-byte secp256k1 one", () => {
    const wallet = testWallet();
    const signature = signText("short", wallet.privateKey);
    assert.equal(recoverAddress("short", signature.slice(0, -2)), null);
    assert.equal(recoverAddress("short", `${signature.slice(0, -2)}05`), null);
    assert.equal(recoverAddress("short", "not hex"), null);
  });
});

describe("normalizing a signer", () => {
  it("compares addresses without case or a missing 0x", () => {
    assert.equal(normalizeAddress("0xABCDEF"), "0xabcdef");
    assert.equal(normalizeAddress("abcdef"), "0xabcdef");
  });
});

describe("the attestation report", () => {
  const nonce = "c".repeat(64);
  const modelSigner = "0x1111111111111111111111111111111111111111";
  const otherSigner = "0x2222222222222222222222222222222222222222";
  const gatewaySigner = "0x3333333333333333333333333333333333333333";
  const report = {
    model_attestations: [
      { request_nonce: nonce, signing_address: modelSigner },
      { request_nonce: "d".repeat(64), signing_address: otherSigner },
    ],
    gateway_attestation: { signing_address: gatewaySigner },
  };

  it("keeps only the model signer whose request nonce matches", () => {
    const check = parseAttestation(report, nonce);
    assert.deepEqual([...check.modelSigners], [modelSigner]);
    assert.equal(check.gatewaySigner, gatewaySigner);
  });

  it("allows the model signer for a provider answer and the gateway signer for a gateway one", () => {
    const check = parseAttestation(report, nonce);
    assert.equal(attestationAllows(check, "provider_tee", modelSigner), true);
    assert.equal(attestationAllows(check, "provider_tee", gatewaySigner), false);
    assert.equal(attestationAllows(check, "gateway", gatewaySigner), true);
    assert.equal(attestationAllows(check, "gateway", modelSigner), false);
    assert.equal(attestationAllows(check, "unknown", modelSigner), true);
    assert.equal(attestationAllows(check, "unknown", gatewaySigner), true);
    assert.equal(attestationAllows(check, "unknown", otherSigner), false);
  });

  it("reads the gateway signer from each shape the app accepts", () => {
    assert.equal(parseAttestation({ gateway: { signing_address: gatewaySigner } }, nonce).gatewaySigner, gatewaySigner);
    assert.equal(
      parseAttestation({ gateway_attestations: [{ signing_address: gatewaySigner }] }, nonce).gatewaySigner,
      gatewaySigner,
    );
    assert.equal(parseAttestation({ gateway_signing_address: gatewaySigner }, nonce).gatewaySigner, gatewaySigner);
  });

  it("finds nothing in a report that is not one", () => {
    for (const value of [null, "report", [], {}, { model_attestations: [{ request_nonce: nonce }] }]) {
      const check = parseAttestation(value, nonce);
      assert.equal(check.modelSigners.size, 0);
      assert.equal(check.gatewaySigner, null);
    }
  });
});

describe("the judge model allowlist", () => {
  it("refuses a list without the abliterated model and accepts one with it", () => {
    assert.equal(lacksJudgeModel([{ id: "Qwen/Qwen3.8-27B" }]), true);
    assert.equal(lacksJudgeModel([{ id: "Qwen/Qwen3.8-27B-abliterated" }]), false);
    assert.equal(lacksJudgeModel(null), false);
  });
});

describe("the CLI", () => {
  it("prints the usage and exits 2 without both arguments, without echoing the code", async () => {
    try {
      await run(process.execPath, [CLI, "https://worker.example", ""]);
      assert.fail("the CLI should have exited 2");
    } catch (failure) {
      const { code, stdout, stderr } = /** @type {{ code: number, stdout: string, stderr: string }} */ (failure);
      assert.equal(code, 2);
      assert.match(stderr, /^Usage: /);
      assert.equal(stdout, "");
      assert.doesNotMatch(stderr, /JUDGE-/);
    }
  });

  it("refuses a worker URL that is not one", async () => {
    try {
      await run(process.execPath, [CLI, "not a url", "JUDGE-secret"]);
      assert.fail("the CLI should have exited 2");
    } catch (failure) {
      const { code, stdout, stderr } = /** @type {{ code: number, stdout: string, stderr: string }} */ (failure);
      assert.equal(code, 2);
      assert.match(stderr, /^Usage: /);
      assert.equal(stdout, "");
      assert.doesNotMatch(stderr, /JUDGE-secret/);
    }
  });
});