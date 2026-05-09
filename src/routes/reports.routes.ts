import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  getMasterSalesReport,
  getMasterPurchaseReport,
  getMasterExpenseReport,
  getShopSalesReport,
  getShopPurchaseReport,
  getShopExpenseReport,
  getGstReport,
  getLoyaltyReport,
} from "../controllers/reports.controller";

const router = Router();

const MASTER_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR"] as const;
const SHOP_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"] as const;

/* Master-level reports */
router.get("/master/sales", auth, requireRoles(...MASTER_ROLES), getMasterSalesReport);
router.get("/master/purchases", auth, requireRoles(...MASTER_ROLES), getMasterPurchaseReport);
router.get("/master/expenses", auth, requireRoles(...MASTER_ROLES), getMasterExpenseReport);

/* Shop-level reports */
router.get("/shop/sales", auth, requireRoles(...SHOP_ROLES), getShopSalesReport);
router.get("/shop/purchases", auth, requireRoles(...SHOP_ROLES), getShopPurchaseReport);
router.get("/shop/expenses", auth, requireRoles(...SHOP_ROLES), getShopExpenseReport);
router.get("/shop/gst", auth, requireRoles(...SHOP_ROLES), getGstReport);
router.get("/shop/loyalty", auth, requireRoles(...SHOP_ROLES), getLoyaltyReport);

export default router;
