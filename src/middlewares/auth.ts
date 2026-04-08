import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  verifyAccessToken,
  type AccessTokenPayload,
  type Role,
} from "../utils/jwt";

export type AuthenticatedUser = {
  sub: string;
  id: string;
  role: Role;
  sid: string;
};

function isAccessPayload(x: unknown): x is AccessTokenPayload {
  if (!x || typeof x !== "object") return false;

  const o = x as any;

  return (
    typeof o.sub === "string" &&
    typeof o.role === "string" &&
    typeof o.sid === "string" &&
    o.type === "access"
  );
}

export function auth(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization;
  const token = hdr?.startsWith("Bearer ") ? hdr.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      code: "TOKEN_MISSING",
      message: "Missing token",
    });
  }

  try {
    const decoded = verifyAccessToken(token);

    if (!isAccessPayload(decoded)) {
      return res.status(401).json({
        success: false,
        code: "INVALID_ACCESS_TOKEN",
        message: "Invalid token payload",
      });
    }

    (req as any).user = {
      sub: decoded.sub,
      id: decoded.sub,
      role: decoded.role,
      sid: decoded.sid,
    } satisfies AuthenticatedUser;

    return next();
  } catch (err: any) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        code: "ACCESS_TOKEN_EXPIRED",
        message: "Access token expired",
      });
    }

    return res.status(401).json({
      success: false,
      code: "INVALID_ACCESS_TOKEN",
      message: "Invalid access token",
    });
  }
}