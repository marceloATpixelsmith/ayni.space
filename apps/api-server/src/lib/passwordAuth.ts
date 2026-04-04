import crypto from "node:crypto";
const PASSWORD_TOKEN_BYTES = 32;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

async function deriveScrypt(
  password: string,
  salt: Buffer,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, options, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

export type PasswordVerificationResult = {
  ok: boolean;
  needsRehash: boolean;
  upgradedHash?: string;
};

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await deriveScrypt(password, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt-v2$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyLegacyScryptHash(hash: string, password: string): Promise<boolean> {
  try {
    const [algo, saltHex, digestHex] = hash.split("$");
    if (algo !== "scrypt" || !saltHex || !digestHex) return false;
    const derived = await deriveScrypt(password, Buffer.from(saltHex, "hex"), { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return crypto.timingSafeEqual(Buffer.from(digestHex, "hex"), derived);
  } catch {
    return false;
  }
}

export async function verifyPassword(hash: string, password: string): Promise<PasswordVerificationResult> {
  if (hash.startsWith("scrypt-v2$")) {
    const [, params, saltHex, digestHex] = hash.split("$");
    if (!params || !saltHex || !digestHex) return { ok: false, needsRehash: false };
    const parsed = Object.fromEntries(params.split(",").map((entry) => entry.split("=")));
    const N = Number(parsed["N"]);
    const r = Number(parsed["r"]);
    const p = Number(parsed["p"]);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return { ok: false, needsRehash: false };
    const derived = await deriveScrypt(password, Buffer.from(saltHex, "hex"), { N, r, p });
    const ok = crypto.timingSafeEqual(Buffer.from(digestHex, "hex"), derived);
    return { ok, needsRehash: false };
  }

  if (hash.startsWith("scrypt$")) {
    const ok = await verifyLegacyScryptHash(hash, password);
    if (!ok) return { ok: false, needsRehash: false };
    const upgradedHash = await hashPassword(password);
    return { ok: true, needsRehash: true, upgradedHash };
  }

  return { ok: false, needsRehash: false };
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getPasswordAuthOpaqueIdentifier(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return hashOpaqueToken(`password-auth:${normalized}`);
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(PASSWORD_TOKEN_BYTES).toString("base64url");
}

export function isStrongEnoughPassword(password: string): boolean {
  return password.length >= 10;
}
