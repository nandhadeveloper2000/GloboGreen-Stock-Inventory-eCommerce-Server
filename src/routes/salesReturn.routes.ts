import { Router } from "express";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createSalesReturn,
  getSalesReturn,
  listEligibleSalesOrders,
  listSalesReturns,
  updateSalesReturn,
} from "../controllers/salesReturn.controller";

const router = Router();

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const CREATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const UPDATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

router.get(
  "/:shopId/eligible-orders",
  auth,
  requireRoles(...VIEW_ROLES),
  listEligibleSalesOrders
);

router.get("/:shopId", auth, requireRoles(...VIEW_ROLES), listSalesReturns);

router.get("/:shopId/:id", auth, requireRoles(...VIEW_ROLES), getSalesReturn);

router.post("/:shopId", auth, requireRoles(...CREATE_ROLES), createSalesReturn);

router.put(
  "/:shopId/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateSalesReturn
);

export default router;
