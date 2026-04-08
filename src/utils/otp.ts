// src/utils/otp.ts
import bcrypt from "bcrypt";

export function generateOtp(len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export async function hashOtp(otp: string) {
  return bcrypt.hash(String(otp), 10);
}

export async function verifyOtp(otp: string, hash: string) {
  return bcrypt.compare(String(otp), hash);
}