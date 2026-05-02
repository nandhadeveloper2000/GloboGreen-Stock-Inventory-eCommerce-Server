import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createPhysicalStockEntry,
  getPhysicalStockEntry,
  listPhysicalStockEntries,
  updatePhysicalStockEntry,
} from "../controllers/physicalStock.controller";

const router = Router();

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const MANAGE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listPhysicalStockEntries);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getPhysicalStockEntry);
router.post("/", auth, requireRoles(...MANAGE_ROLES), createPhysicalStockEntry);
router.put("/:id", auth, requireRoles(...MANAGE_ROLES), updatePhysicalStockEntry);

export default router;
