import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_TOKEN_BYTES = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    const [algo, saltHex, digestHex] = hash.split("$");
    if (algo !== "scrypt" || !saltHex || !digestHex) return false;
    const derived = (await scryptAsync(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
    return crypto.timingSafeEqual(Buffer.from(digestHex, "hex"), derived);
  } catch {
    return false;
  }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(PASSWORD_TOKEN_BYTES).toString("base64url");
}

export function isStrongEnoughPassword(password: string): boolean {
  return password.length >= 10;
}
