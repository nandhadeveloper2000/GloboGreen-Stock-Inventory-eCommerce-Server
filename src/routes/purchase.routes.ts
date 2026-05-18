import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { validateObjectId } from "../middlewares/validateObjectId";
import { validate } from "../middlewares/validate";
import { requireShopAccess } from "../middlewares/requireShopAccess";
import { CreatePurchaseSchema } from "../schemas";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  updatePurchaseOrder,
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

const UPDATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
] as const;

router.get(
  "/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  validateObjectId("shopId"),
  requireShopAccess("shopId"),
  listPurchaseOrders
);

router.get(
  "/:shopId/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  validateObjectId("shopId", "id"),
  requireShopAccess("shopId"),
  getPurchaseOrder
);

router.post(
  "/:shopId",
  auth,
  requireRoles(...CREATE_ROLES),
  validateObjectId("shopId"),
  requireShopAccess("shopId"),
  validate(CreatePurchaseSchema),
  createPurchaseOrder
);

router.put(
  "/:shopId/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  validateObjectId("shopId", "id"),
  requireShopAccess("shopId"),
  updatePurchaseOrder
);

router.patch(
  "/:shopId/:id/cancel",
  auth,
  requireRoles(...DELETE_ROLES),
  validateObjectId("shopId", "id"),
  requireShopAccess("shopId"),
  cancelPurchaseOrder
);

export default router;
