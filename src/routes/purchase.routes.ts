import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
} from "../controllers/purchase.controller";

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

const DELETE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
] as const;

router.get(
  "/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  listPurchaseOrders
);

router.get(
  "/:shopId/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getPurchaseOrder
);

router.post(
  "/:shopId",
  auth,
  requireRoles(...CREATE_ROLES),
  createPurchaseOrder
);

router.patch(
  "/:shopId/:id/cancel",
  auth,
  requireRoles(...DELETE_ROLES),
  cancelPurchaseOrder
);

export default router;