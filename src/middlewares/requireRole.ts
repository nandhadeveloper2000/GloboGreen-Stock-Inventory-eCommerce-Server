import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types/auth";
import type { Role } from "../utils/jwt";

export function requireRole(...allowed: Role[]) {
  const allowedSet = new Set(allowed);

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // auth middleware MUST run before this
    const role = req.user?.role;

    if (!role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!allowedSet.has(role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return next();
  };
}