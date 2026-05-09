import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { getMasterDashboardStats, getShopDashboardStats } from "../controllers/dashboard.controller";

const router = Router();

const MASTER_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"] as const;
const SHOP_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;

router.get("/master", auth, requireRoles(...MASTER_ROLES), getMasterDashboardStats);
router.get("/shop", auth, requireRoles(...MASTER_ROLES, ...SHOP_ROLES), getShopDashboardStats);

export default router;
