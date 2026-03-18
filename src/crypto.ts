import { createHash, createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";

export const sha256Hex = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");

export const hmacSha256Hex = (secret: string, input: string | Buffer): string =>
  createHmac("sha256", secret).update(input).digest("hex");

export const verifyHmacSha256Hex = (
  secret: string,
  input: string | Buffer,
  expectedHex: string
): boolean => safeEqualsHex(hmacSha256Hex(secret, input), expectedHex);

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
};

export const safeEqualsHex = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return timingSafeEqual(leftBytes, rightBytes);
};

const normalizePublicKey = (publicKey: string): string => {
  if (publicKey.includes("BEGIN PUBLIC KEY")) {
    return publicKey;
  }

  const chunks = publicKey.match(/.{1,64}/g) ?? [publicKey];
  return `-----BEGIN PUBLIC KEY-----\n${chunks.join("\n")}\n-----END PUBLIC KEY-----`;
};

export const verifySendGridSignature = (
  publicKey: string,
  signatureBase64: string,
  timestamp: string,
  rawPayload: Buffer
): boolean => {
  const verifier = createVerify("sha256");
  verifier.update(Buffer.from(timestamp, "utf8"));
  verifier.update(rawPayload);
  verifier.end();

  return verifier.verify(
    createPublicKey(normalizePublicKey(publicKey)),
    Buffer.from(signatureBase64, "base64")
  );
};
