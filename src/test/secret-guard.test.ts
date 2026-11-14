import { describe, expect, it } from "vitest";
import { entropyBitsPerChar, maskSecret, scanSecretText } from "../lib/secret-guard";

const AWS = ["AKIA", "IOSFODNN7EXAMPL", "E"].join("");
const RSA_HEADER = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
const PRIVATE_HEADER = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const PRIVATE_END = ["-----END", "PRIVATE KEY-----"].join(" ");
const GITHUB = `ghp_${"a".repeat(36)}`;
const GITHUB_PAT = `github_pat_${"b".repeat(30)}`;
const OPENAI = `sk-proj-${"c".repeat(30)}`;
const ANTHROPIC = `sk-ant-api03-${"d".repeat(24)}`;
const SLACK = `xoxb-${"1".repeat(12)}`;
const GENERIC_SK = `sk-${"Q7m2Lp9Rt4Vw8KxN3b6Yc1D"}`;

describe("scanSecretText", () => {
  it("finds every supported kind with the canvas name", () => {
    const text = [
      RSA_HEADER,
      AWS,
      GITHUB,
      GITHUB_PAT,
      OPENAI,
      ANTHROPIC,
      SLACK,
    ].join("\n");

    expect(scanSecretText(text).map((match) => match.kind)).toEqual([
      "Private key",
      "AWS access key",
      "GitHub token",
      "GitHub token",
      "API key",
      "API key",
      "Slack token",
    ]);
  });

  it("reports a line and an attached file, or null for the message", () => {
    const matches = scanSecretText(`ordinary\n${AWS}\n`, ".env.local");

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ file: ".env.local", line: 2 });
    expect(scanSecretText(`\n\n${AWS}`)[0].file).toBeNull();
    expect(scanSecretText(`\n\n${AWS}`)[0].line).toBe(3);
  });

  it("detects a high-entropy .env assignment and names its kind", () => {
    const text = "DATABASE_PASSWORD=Zx9Qm2Lp7Rt4Vw8K\napi_token=Zx9Qm2Lp7Rt4Vw8K\n";

    expect(scanSecretText(text).map((match) => match.kind)).toEqual(["Password", "Token"]);
  });

  it("keeps a low-entropy .env value out", () => {
    expect(scanSecretText("API_KEY=aaaaaaaaaaaaaaaa")).toEqual([]);
    expect(entropyBitsPerChar("aaaaaaaaaaaaaaaa")).toBe(0);
  });

  it("finds bare TOKEN, PASSWORD and SECRET assignments", () => {
    const text = "TOKEN=Zx9Qm2Lp7Rt4Vw8K\nPASSWORD=Zx9Qm2Lp7Rt4Vw8K\nSECRET=Zx9Qm2Lp7Rt4Vw8K";

    expect(scanSecretText(text).map((match) => match.kind)).toEqual(["Token", "Password", "Secret"]);
  });

  it("keeps values that name where a secret comes from out", () => {
    const text = [
      "SECRET_KEY = os.environ.get('SECRET_KEY')",
      "API_TOKEN=${API_TOKEN}",
      "PASSWORD=process.env.PASSWORD",
    ].join("\n");

    expect(scanSecretText(text)).toEqual([]);
  });

  it("keeps function-call references out but still catches a dollar-prefixed password", () => {
    const references = [
      'PASSWORD=getenv("PASSWORD")',
      'SECRET=env("SECRET_VALUE")',
      'TOKEN=request.form["token"]',
      "API_KEY=$ENVIRONMENT_API_KEY",
      "PASSWORD=${DATABASE_PASSWORD}",
    ].join("\n");
    expect(scanSecretText(references)).toEqual([]);

    expect(scanSecretText("PASSWORD=$uP3rS3cretV4lueXyZ").map((match) => match.kind)).toEqual([
      "Password",
    ]);
  });

  it("takes a long ghs_ token and a PGP private-key block", () => {
    const ghs = `ghs_${"a".repeat(40)}`;
    const pgp = ["-----BEGIN", "PGP PRIVATE KEY BLOCK-----"].join(" ");

    expect(scanSecretText(`${ghs}\n${pgp}`).map((match) => match.kind)).toEqual([
      "GitHub token",
      "Private key",
    ]);
    expect(scanSecretText(pgp)[0].preview).toBe("BEGIN PGP PRIVATE KEY BLOCK");
  });

  it("takes a random sk- key but not the sk-learn and sk-cube words", () => {
    expect(scanSecretText(GENERIC_SK).map((match) => match.kind)).toEqual(["API key"]);
    expect(scanSecretText("sk-learn-for-python-tutorial")).toEqual([]);
    expect(scanSecretText("sk-cube-grid-animation")).toEqual([]);
  });

  it("does not report ordinary code, UUIDs, hashes, prose or lockfile integrity strings", () => {
    const ordinary = [
      "const token = process.env.API_TOKEN;",
      "export const key = await readSecret();",
      "const id = '123e4567-e89b-12d3-a456-426614174000';",
      "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      "Use sk- to refer to the skill in prose.",
      "dependencies:",
      "  integrity: sha512-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH",
      "sk-learn is a Python package.",
    ].join("\n");

    expect(scanSecretText(ordinary)).toEqual([]);
  });

  it("does not report a token-like prefix when it is shorter than the real shape", () => {
    expect(scanSecretText("sk-short")).toEqual([]);
    expect(scanSecretText("AKIA1234")).toEqual([]);
    expect(scanSecretText("ghp_short")).toEqual([]);
    expect(scanSecretText("xoxb-short")).toEqual([]);
  });

  it("reports an AWS key in a .env line once, as the specific key", () => {
    const matches = scanSecretText(`AWS_ACCESS_KEY_ID=${AWS}`);

    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("AWS access key");
  });

  it("masks with the canvas's 4 + bullets + 4, and 2 + bullets + 2 under 16 characters", () => {
    expect(maskSecret(AWS)).toBe("AKIA••••••••MPLE");
    expect(maskSecret("AKIA12345678")).toBe("AK••••••••78");
    expect(maskSecret(AWS)).not.toContain(AWS);
  });

  it("keeps the private-key row to its header, never the key body", () => {
    const matches = scanSecretText(`${PRIVATE_HEADER}\nMIIBOgIBAAJBAK\n${PRIVATE_END}`);

    expect(matches).toHaveLength(1);
    expect(matches[0].preview).toBe("BEGIN PRIVATE KEY");
  });
});