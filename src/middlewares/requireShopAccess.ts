import { Request, Response, NextFunction } from "express";
import { isValidObjectId } from "mongoose";
import { ShopModel } from "../models/shop.model";
import { ShopStaffModel } from "../models/shopstaff.model";

type AuthUser = { id?: string; sub?: string; role?: string };

// Master/Admin roles that can access any shop
const MASTER_ROLES = new Set([
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
]);

/**
 * Validates that the authenticated user has access to the shop specified in
 * `req.params.shopId`. Prevents cross-tenant data access:
 *
 *  - MASTER_ADMIN / MANAGER / SUPERVISOR / STAFF: full access to every shop
 *  - SHOP_OWNER: must be the registered owner of the shop
 *  - SHOP_MANAGER / SHOP_SUPERVISOR / EMPLOYEE: must be employed by the shop
 *
 * Usage: router.get("/:shopId", auth, requireShopAccess(), handler)
 * Custom param: router.get("/:sid", auth, requireShopAccess("sid"), handler)
 */
export function requireShopAccess(paramName = "shopId") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as AuthUser | undefined;
      const userId = user?.id || user?.sub;
      const role = user?.role;

      if (!userId || !role) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      // Master-tier roles bypass shop-ownership checks
      if (MASTER_ROLES.has(role)) {
        return next();
      }

      const shopId = req.params[paramName];

      if (!shopId || !isValidObjectId(shopId)) {
        return res.status(400).json({ success: false, message: "Invalid shopId" });
      }

      if (role === "SHOP_OWNER") {
        const shop = await ShopModel.findOne({
          _id: shopId,
          shopOwnerAccountId: userId,
          isDeleted: { $ne: true },
        })
          .select("_id shopOwnerAccountId")
          .lean();

        if (!shop) {
          return res
            .status(403)
            .json({ success: false, message: "Forbidden: shop not owned by you" });
        }

        return next();
      }

      // SHOP_MANAGER / SHOP_SUPERVISOR / EMPLOYEE — must be staff of this shop
      if (["SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"].includes(role)) {
        const staffRecord = await ShopStaffModel.findOne({
          _id: userId,
          shopId,
          isActive: true,
          isDeleted: { $ne: true },
        })
          .select("_id")
          .lean();

        if (!staffRecord) {
          return res
            .status(403)
            .json({ success: false, message: "Forbidden: you are not staff of this shop" });
        }

        return next();
      }

      return res.status(403).json({ success: false, message: "Forbidden" });
    } catch (err: any) {
      return res
        .status(500)
        .json({ success: false, message: "Shop access check failed" });
    }
  };
}
