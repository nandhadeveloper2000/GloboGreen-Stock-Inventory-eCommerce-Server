import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import crypto from "crypto";

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

type TokenType = "access" | "refresh";

type BaseTokenPayload = {
  sub: string;
  role: Role;
  type: TokenType;
  sid: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
  jti?: string;
};

export type AccessTokenPayload = BaseTokenPayload & {
  type: "access";
};

export type RefreshTokenPayload = BaseTokenPayload & {
  type: "refresh";
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const ACCESS_SECRET = (): Secret => mustEnv("JWT_ACCESS_SECRET");
const REFRESH_SECRET = (): Secret => mustEnv("JWT_REFRESH_SECRET");
const JWT_ISSUER = (): string => mustEnv("JWT_ISSUER");
const JWT_AUDIENCE = (): string => mustEnv("JWT_AUDIENCE");

const ACCESS_EXPIRES = (): SignOptions["expiresIn"] =>
  (process.env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"]) || "1d";

const REFRESH_EXPIRES = (): SignOptions["expiresIn"] =>
  (process.env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"]) || "30d";

export function createSessionId(): string {
  return crypto.randomUUID();
}

export function signAccessToken(sub: string, role: Role, sid: string): string {
  const payload: AccessTokenPayload = {
    sub,
    role,
    type: "access",
    sid,
  };

  return jwt.sign(payload, ACCESS_SECRET(), {
    algorithm: "HS256",
    issuer: JWT_ISSUER(),
    audience: JWT_AUDIENCE(),
    expiresIn: ACCESS_EXPIRES(),
    jwtid: crypto.randomUUID(),
  });
}

export function signRefreshToken(sub: string, role: Role, sid: string): string {
  const payload: RefreshTokenPayload = {
    sub,
    role,
    type: "refresh",
    sid,
  };

  return jwt.sign(payload, REFRESH_SECRET(), {
    algorithm: "HS256",
    issuer: JWT_ISSUER(),
    audience: JWT_AUDIENCE(),
    expiresIn: REFRESH_EXPIRES(),
    jwtid: crypto.randomUUID(),
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, ACCESS_SECRET(), {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER(),
    audience: JWT_AUDIENCE(),
  }) as AccessTokenPayload;

  if (decoded.type !== "access") {
    throw new Error("Invalid access token type");
  }

  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, REFRESH_SECRET(), {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER(),
    audience: JWT_AUDIENCE(),
  }) as RefreshTokenPayload;

  if (decoded.type !== "refresh") {
    throw new Error("Invalid refresh token type");
  }

  return decoded;
}