import { Response, NextFunction } from "express";

export function requireRoles(...allowed: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  };
}

export const requireMaster = requireRoles("MASTER_ADMIN");

// optional (for subadmin logout etc.)
export const requireSubAdmin = requireRoles("SUPERVISOR", "MANAGER");