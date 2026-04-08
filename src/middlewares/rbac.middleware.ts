import { Response, NextFunction } from "express";

type RequestWithUser = {
  user?: {
    role?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

export function requireRoles(...allowed: string[]) {
  return (req: RequestWithUser, res: Response, next: NextFunction) => {
    const role = req.user?.role;

    if (!role || !allowed.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    next();
  };
}

export const requireMaster = requireRoles("MASTER_ADMIN");

export const requireManager = requireRoles("MANAGER");

export const requireSupervisor = requireRoles("SUPERVISOR");

export const requireStaff = requireRoles("STAFF");

export const requireManagerOrSupervisor = requireRoles(
  "MANAGER",
  "SUPERVISOR"
);

export const requireManagerOrSupervisorOrStaff = requireRoles(
  "MANAGER",
  "SUPERVISOR",
  "STAFF"
);

/**
 * Backward-compatible alias
 * Earlier you used requireSubAdmin for manager/supervisor access.
 * Keep this so old routes won't break immediately.
 */
export const requireSubAdmin = requireRoles("MANAGER", "SUPERVISOR");