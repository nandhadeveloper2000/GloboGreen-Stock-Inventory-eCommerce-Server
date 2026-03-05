import jwt, { type SignOptions, type Secret } from "jsonwebtoken";

export type Role =
  | "MASTER_ADMIN"
  | "MANAGER"
  | "SUPERVISOR"
  | "STAFF"
  | "SHOP_OWNER"
  | "SHOP_MANAGER"
  | "SHOP_SUPERVISOR"
  | "EMPLOYEE"
  | "CUSTOMER";

export type AccessTokenPayload = {
  sub: string;
  role: Role;
  iat?: number;
  exp?: number;
};

export type RefreshTokenPayload = {
  sub: string;
  role: Role;
  iat?: number;
  exp?: number;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const ACCESS_SECRET = (): Secret => mustEnv("JWT_ACCESS_SECRET");
const REFRESH_SECRET = (): Secret => mustEnv("JWT_REFRESH_SECRET");

const ACCESS_EXPIRES = (): SignOptions["expiresIn"] =>
  (process.env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"]) || "1h";

const REFRESH_EXPIRES = (): SignOptions["expiresIn"] =>
  (process.env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"]) || "7d";

export function signAccessToken(sub: string, role: Role) {
  const payload: AccessTokenPayload = { sub, role };
  return jwt.sign(payload, ACCESS_SECRET(), { expiresIn: ACCESS_EXPIRES() });
}

export function signRefreshToken(sub: string, role: Role) {
  const payload: RefreshTokenPayload = { sub, role };
  return jwt.sign(payload, REFRESH_SECRET(), { expiresIn: REFRESH_EXPIRES() });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET()) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_SECRET()) as RefreshTokenPayload;
}