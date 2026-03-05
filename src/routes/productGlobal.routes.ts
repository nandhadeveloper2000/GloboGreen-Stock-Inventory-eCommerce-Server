import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import { listGlobalProducts, createGlobalProduct } from "../controllers/productGlobal.controller";

const router = Router();

const VIEW_ROLES = ["MASTER_ADMIN","MANAGER","SHOP_OWNER","SHOP_MANAGER","SHOP_SUPERVISOR","EMPLOYEE"] as const;
const CREATE_ROLES = ["SHOP_OWNER","SHOP_MANAGER","SHOP_SUPERVISOR"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listGlobalProducts);
router.post("/", auth, requireRoles(...CREATE_ROLES), createGlobalProduct);

export default router;