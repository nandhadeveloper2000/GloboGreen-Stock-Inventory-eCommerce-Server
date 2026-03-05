  import type { Response, NextFunction } from "express";
  import type { AuthRequest } from "../types/auth";
  import { verifyAccessToken } from "../utils/jwt";

  export function auth(req: AuthRequest, res: Response, next: NextFunction) {
    const hdr = req.headers.authorization;
    const token = hdr?.startsWith("Bearer ") ? hdr.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, message: "Missing token" });
    }

    try {
      const decoded = verifyAccessToken(token); // { sub, role }
      req.user = { id: decoded.sub, role: decoded.role };
      return next();
    } catch {
      return res.status(401).json({ success: false, message: "Invalid/expired token" });
    }
  }