import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import { listGlobalVendors, createGlobalVendor } from "../controllers/vendorGlobal.controller";

const router = Router();

const VIEW_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const CREATE_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listGlobalVendors);
router.post("/", auth, requireRoles(...CREATE_ROLES), createGlobalVendor);

export default router;