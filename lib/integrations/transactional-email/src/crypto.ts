import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LENGTH = 12;

type EncryptedValue = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: string;
};

function getKeyBytes(secret: string): Buffer {
  const normalized = secret.trim();
  if (normalized.length !== 64) {
    throw new Error("EMAIL_CREDENTIALS_ENCRYPTION_KEY must be 64 hex chars");
  }
  return Buffer.from(normalized, "hex");
}

export function encryptJson(plain: object, secret: string, version = "v1"): string {
  const iv = randomBytes(IV_LENGTH);
  const key = getKeyBytes(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const input = Buffer.from(JSON.stringify(plain), "utf8");
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedValue = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    version,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decryptJson<T>(encrypted: string, secret: string): T {
  const decoded = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8")) as EncryptedValue;
  const key = getKeyBytes(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(decoded.iv, "base64"));
  decipher.setAuthTag(Buffer.from(decoded.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(decoded.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
