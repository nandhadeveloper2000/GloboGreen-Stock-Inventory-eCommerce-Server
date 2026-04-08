// src/utils/pin.ts
import bcrypt from "bcrypt";

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

export async function hashPin(value: string) {
  const v = String(value ?? "").trim();
  return bcrypt.hash(v, SALT_ROUNDS);
}

export async function comparePin(value: string, hash: string) {
  if (!hash) return false;
  const v = String(value ?? "").trim();
  return bcrypt.compare(v, hash);
}