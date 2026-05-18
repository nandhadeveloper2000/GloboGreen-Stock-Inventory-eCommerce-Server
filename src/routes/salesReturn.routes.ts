import { Router } from "express";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { validateObjectId } from "../middlewares/validateObjectId";
import { requireShopAccess } from "../middlewares/requireShopAccess";
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
  validateObjectId("shopId"),
  requireShopAccess("shopId"),
  listEligibleSalesOrders
);

router.get(
  "/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  validateObjectId("shopId"),
  requireShopAccess("shopId"),
  listSalesReturns
);

router.get(
  "/:shopId/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  validateObjectId("shopId", "id"),
  requireShopAccess("shopId"),
  getSalesReturn
);

router.post(
  "/:shopId",
  auth,
  requireRoles(...CREATE_ROLES),
  validateObjectId("shopId"),
  requireShopAccess("shopId"),
  createSalesReturn
);

router.put(
  "/:shopId/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  validateObjectId("shopId", "id"),
  requireShopAccess("shopId"),
  updateSalesReturn
);

export default router;
