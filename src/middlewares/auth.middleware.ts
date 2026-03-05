import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AccessTokenPayload } from "../utils/jwt";

function isAccessPayload(x: unknown): x is AccessTokenPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as any;
  return typeof o.sub === "string" && typeof o.role === "string";
}

export function auth(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization;
  const token = hdr?.startsWith("Bearer ") ? hdr.slice(7) : null;

  if (!token) return res.status(401).json({ success: false, message: "Missing token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!);

    if (!isAccessPayload(decoded)) {
      return res.status(401).json({ success: false, message: "Invalid token payload" });
    }

    (req as any).user = { sub: decoded.sub, role: decoded.role };
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid/expired token" });
  }
}