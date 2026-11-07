#!/usr/bin/env node
// Gets a NEAR AI Cloud refresh token for the operator account, to store with
// `wrangler secret put OPERATOR_REFRESH_TOKEN`. Run it yourself on your own Mac:
//
//   node server/scripts/operator-login.mjs <operator-account-id> <path-to-key-file> --dry-run
//   node server/scripts/operator-login.mjs <operator-account-id> <path-to-key-file>
//
// The key file holds a FULL-ACCESS ed25519 key of that account: either a near-cli credentials file
// (JSON with "private_key") or a text file with just "ed25519:<base58>". The key is read here and
// nowhere else; it is never passed on the command line, printed, logged or sent. The only thing
// sent is the signature of a one-time sign-in message. On success the refresh token is the only
// thing printed to stdout; everything else goes to stderr.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { KeyPair } from "@near-js/crypto";
import { buildLoginRequest, buildNep413Payload, LOGIN_MESSAGE, LOGIN_RECIPIENT } from "./nep413.mjs";

export { buildNep413Payload };

const LOGIN_URL = "https://cloud-api.near.ai/v1/auth/near";
const USER_AGENT = "zorvo-credits-operator-login/1";
const REQUEST_TIMEOUT_MS = 20_000;
const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const FALLBACK =
  "Fallback: sign in to the NEAR AI Cloud dashboard with the operator account, copy a refresh token from that session, and store it with `wrangler secret put OPERATOR_REFRESH_TOKEN`.";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

/** The ed25519 key pair in the file, or null; whatever the file holds is never put into a message. */
function readKeyPair(path) {
  try {
    const text = readFileSync(path, "utf8").trim();
    const secret = text.startsWith("{") ? (JSON.parse(text).private_key ?? JSON.parse(text).secret_key) : text;
    const keyPair = KeyPair.fromString(secret);
    return keyPair.getPublicKey().toString().startsWith("ed25519:") ? keyPair : null;
  } catch {
    return null;
  }
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const [accountId, keyPath, ...extra] = argv.filter((arg) => arg !== "--dry-run");
  if (!accountId || !keyPath || extra.length > 0) {
    return fail("Usage: node operator-login.mjs <operator-account-id> <path-to-key-file> [--dry-run]");
  }
  if (!ACCOUNT_ID.test(accountId)) return fail("That does not look like a NEAR account id.");

  const keyPair = readKeyPair(keyPath);
  if (keyPair === null) return fail("Could not read an ed25519 NEAR key from that file (expected a near-cli credentials file or `ed25519:<base58>`).");
  const signer = { publicKey: keyPair.getPublicKey().toString(), sign: (digest) => keyPair.sign(digest).signature };

  const payload = buildNep413Payload(Date.now(), randomBytes(24));
  if (dryRun) {
    console.log(`account:    ${accountId}`);
    console.log(`public key: ${signer.publicKey}`);
    console.log(`message:    ${LOGIN_MESSAGE}`);
    console.log(`recipient:  ${LOGIN_RECIPIENT}`);
    console.log(`nonce:      ${hex(payload.nonce)}`);
    console.error("Dry run: nothing was signed or sent.");
    return;
  }

  const request = await buildLoginRequest(accountId, signer, payload);
  let response;
  try {
    response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return fail(`NEAR AI did not answer (network error or timeout).\n${FALLBACK}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.refresh_token !== "string" || body.refresh_token === "") {
    const code = typeof body?.error === "string" ? ` (${body.error.slice(0, 60)})` : "";
    return fail(`NEAR AI refused the login: HTTP ${response.status}${code}.\n${FALLBACK}`);
  }
  console.log(body.refresh_token);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
