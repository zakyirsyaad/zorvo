// The operator login CLI on Node (`node --test`): its failure paths, the dry run, the signer, `visible`
// and the start through a symlink. Nothing here reaches NEAR AI: the live path gets a fake `fetch`, and
// the key files are throwaway keys made by the test.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { KeyPair } from "@near-js/crypto";
import { main, signerFor, visible } from "./operator-login.mjs";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("./operator-login.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "zorvo-login-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A throwaway ed25519 key in a near-cli credentials file, and its key pair. */
function keyFile() {
  const keyPair = KeyPair.fromRandom("ed25519");
  const path = join(dir, `key-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({ account_id: "operator.near", private_key: keyPair.toString() }));
  return { path, keyPair };
}

/**
 * Runs the CLI as a child process; resolves with its exit code and output, failing or not.
 * @param {string[]} args
 * @param {string} [script]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function cli(args, script = CLI) {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, ...args]);
    return { code: 0, stdout, stderr };
  } catch (failure) {
    const { code, stdout, stderr } = /** @type {{ code: number, stdout: string, stderr: string }} */ (failure);
    return { code, stdout, stderr };
  }
}

/**
 * Runs `main` in this process with `fetcher`, capturing what it prints and the exit code it sets.
 * @param {string[]} argv
 * @param {typeof fetch} fetcher
 */
async function inProcess(argv, fetcher) {
  const errors = mock.method(console, "error", () => {});
  const logs = mock.method(console, "log", () => {});
  try {
    await main(argv, fetcher);
    return {
      code: process.exitCode,
      stderr: errors.mock.calls.map((call) => call.arguments.join(" ")).join("\n"),
      stdout: logs.mock.calls.map((call) => call.arguments.join(" ")).join("\n"),
    };
  } finally {
    errors.mock.restore();
    logs.mock.restore();
    process.exitCode = undefined;
  }
}

describe("the CLI's failure paths", () => {
  it("prints the usage and exits 1 without both arguments", async () => {
    const result = await cli(["operator.near"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^Usage: /);
    assert.equal(result.stdout, "");
  });

  it("refuses an account id that is not one", async () => {
    const result = await cli(["Not An Account", keyFile().path]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not look like a NEAR account id/);
  });

  it("refuses a key file it cannot read, without printing what the file holds", async () => {
    const path = join(dir, "garbage.txt");
    writeFileSync(path, "ed25519:not-base58-secret-0OIl");
    const result = await cli(["operator.near", path]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Could not read an ed25519 NEAR key/);
    assert.doesNotMatch(result.stderr + result.stdout, /not-base58-secret/);
  });
});

describe("the dry run", () => {
  it("shows the public key and the payload, and signs and sends nothing", async () => {
    const { path, keyPair } = keyFile();
    const result = await cli(["operator.near", path, "--dry-run"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, new RegExp(`public key: ${keyPair.getPublicKey().toString()}`));
    assert.match(result.stdout, /recipient: {2}cloud\.near\.ai/);
    assert.match(result.stdout, /nonce: {6}[0-9a-f]{64}/);
    assert.match(result.stderr, /nothing was signed or sent/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(keyPair.toString().slice(8, 30)));
  });

  it("runs when started through a symlink, and not when imported", async () => {
    const link = join(dir, "login-link.mjs");
    symlinkSync(CLI, link);
    const result = await cli(["operator.near", keyFile().path, "--dry-run"], link);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /public key: ed25519:/);
    // This test file imported the module above, and `main` did not run: nothing was printed or set.
    assert.equal(process.exitCode, undefined);
  });
});

describe("the live path, with a fake NEAR AI", () => {
  it("prints only the refresh token on success, after sending a signature of the key in the file", async () => {
    const { path, keyPair } = keyFile();
    /** @type {RequestInit | undefined} */
    let sent;
    const fetcher = /** @type {typeof fetch} */ (
      async (_url, init) => {
        sent = init;
        return new Response(JSON.stringify({ refresh_token: "ref-token-1" }), { status: 200 });
      }
    );
    const result = await inProcess(["operator.near", path], fetcher);
    assert.equal(result.code, undefined);
    assert.equal(result.stdout, "ref-token-1");
    const body = JSON.parse(String(sent?.body));
    assert.equal(body.signed_message.publicKey, keyPair.getPublicKey().toString());
    assert.doesNotMatch(String(sent?.body), new RegExp(keyPair.toString().slice(8, 30)));
  });

  it("explains a refusal with the server's text made visible, and the fallback", async () => {
    const fetcher = /** @type {typeof fetch} */ (
      async () => new Response(JSON.stringify({ error: "bad‮sig", error_description: "line\nbreak⁦" }), { status: 401 })
    );
    const result = await inProcess(["operator.near", keyFile().path], fetcher);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /NEAR AI refused the login: HTTP 401 \(bad sig\): line break \./);
    assert.match(result.stderr, /Fallback: /);
    assert.equal(result.stdout, "");
  });

  it("says NEAR AI did not answer when the request fails", async () => {
    const fetcher = /** @type {typeof fetch} */ (
      async () => {
        throw new TypeError("network down");
      }
    );
    const result = await inProcess(["operator.near", keyFile().path], fetcher);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /NEAR AI did not answer/);
  });
});

describe("signerFor", () => {
  it("signs the digest as it is, with the file's key", async () => {
    const keyPair = KeyPair.fromRandom("ed25519");
    const signer = signerFor(keyPair);
    const digest = new Uint8Array(32).fill(7);
    assert.equal(signer.publicKey, keyPair.getPublicKey().toString());
    assert.equal(keyPair.verify(digest, await signer.sign(digest)), true);
  });
});

describe("visible", () => {
  it("turns control, separator and bidi characters into spaces and cuts the text", () => {
    assert.equal(visible("a\u0000b\u001bc d", 100), "a b c d");
    assert.equal(visible("x‮y⁦z‏!؜?", 100), "x y z ! ?");
    assert.equal(visible("abcdef", 3), "abc");
  });
});
