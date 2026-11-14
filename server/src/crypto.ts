const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IV_BYTES = 12;
/** AES-256: KEY_ENCRYPTION_KEY must decode to exactly this many bytes. */
const AES_KEY_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** `bytes` random bytes as an unpadded base64url string (43 characters for the default 32). */
export function randomSecret(bytes = 32): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
}

export async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(msg)));
}

/** Compares two strings in time that depends on their length only, never on where they first differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** The AES-256-GCM key; a key of another size (AES-128 or AES-192 would import) is refused. */
async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyB64);
  if (raw.length !== AES_KEY_BYTES) throw new Error(`The encryption key must be ${AES_KEY_BYTES} bytes, base64`);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM with a fresh 12-byte IV; returns base64 of IV followed by the ciphertext. `keyB64` is a base64 32-byte key. */
export async function encrypt(keyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), encoder.encode(plain));
  const blob = new Uint8Array(IV_BYTES + sealed.byteLength);
  blob.set(iv);
  blob.set(new Uint8Array(sealed), IV_BYTES);
  return toBase64(blob);
}

/** Reverses `encrypt`; rejects when the key is wrong or the blob was changed. */
export async function decrypt(keyB64: string, blob: string): Promise<string> {
  const bytes = fromBase64(blob);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) },
    await aesKey(keyB64),
    bytes.slice(IV_BYTES),
  );
  return decoder.decode(plain);
}
