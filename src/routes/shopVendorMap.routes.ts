import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  addVendorToShop,
  updateShopVendor,
  listShopVendors,
  deactivateShopVendor,
} from "../controllers/shopVendorMap.controller";

const router = Router();

const VIEW_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const CREATE_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"] as const;
const DEACTIVATE_ROLES = ["SHOP_OWNER", "SHOP_MANAGER"] as const;

router.get("/:shopId/vendors", auth, requireRoles(...VIEW_ROLES), listShopVendors);
router.post("/:shopId/vendors", auth, requireRoles(...CREATE_ROLES), addVendorToShop);
router.put("/:shopId/vendors/:vendorId", auth, requireRoles(...CREATE_ROLES), updateShopVendor);

// soft delete mapping
router.delete("/:shopId/vendors/:vendorId", auth, requireRoles(...DEACTIVATE_ROLES), deactivateShopVendor);

export default router;