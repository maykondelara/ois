import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string) {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export function createPasswordResetToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
