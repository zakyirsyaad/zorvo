export const LOGIN_MESSAGE: "Sign in to NEAR AI Cloud";
export const LOGIN_RECIPIENT: "cloud.near.ai";

export type Nep413Payload = { message: string; nonce: number[] | Uint8Array; recipient: string; callbackUrl: string | null };
/** The operator's key as the CLI wraps it: `publicKey` is "ed25519:<base58>", `sign` signs the digest as it is. */
export type Signer = { publicKey: string; sign: (digest: Uint8Array) => Uint8Array | Promise<Uint8Array> };

export function buildNep413Payload(nowMs: number, random24: Uint8Array): { message: string; nonce: number[]; recipient: "cloud.near.ai" };
export function serializeNep413(payload: Nep413Payload): Uint8Array;
export function nep413Digest(payload: Nep413Payload): Promise<Uint8Array>;
export function buildLoginRequest(
  accountId: string,
  signer: Signer,
  payload: { message: string; nonce: number[]; recipient: string },
): Promise<{
  signed_message: { accountId: string; publicKey: string; signature: string };
  payload: Nep413Payload;
}>;
