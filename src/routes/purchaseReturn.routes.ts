import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createPurchaseReturn,
  getPurchaseReturn,
  listEligiblePurchaseOrders,
  listPurchaseReturns,
  updatePurchaseReturn,
} from "../controllers/purchaseReturn.controller";

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
] as const;

const UPDATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
] as const;

router.get(
  "/:shopId/eligible-purchases",
  auth,
  requireRoles(...VIEW_ROLES),
  listEligiblePurchaseOrders
);

router.get(
  "/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  listPurchaseReturns
);

router.get(
  "/:shopId/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getPurchaseReturn
);

router.post(
  "/:shopId",
  auth,
  requireRoles(...CREATE_ROLES),
  createPurchaseReturn
);

router.put(
  "/:shopId/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updatePurchaseReturn
);

export default router;
