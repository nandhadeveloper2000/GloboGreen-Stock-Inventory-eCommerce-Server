import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  bulkCreateShopBrandMaps,
  createShopBrandMap,
  deleteShopBrandMap,
  getShopBrandMapById,
  listShopBrandMaps,
  listShopBrandsByShop,
  toggleShopBrandMap,
  updateShopBrandMap,
} from "../controllers/shopBrandMap.controller";

const router = Router();

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
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

const DELETE_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listShopBrandMaps);

router.get(
  "/shop/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  listShopBrandsByShop
);

router.post(
  "/bulk",
  auth,
  requireRoles(...CREATE_ROLES),
  bulkCreateShopBrandMaps
);

router.post("/", auth, requireRoles(...CREATE_ROLES), createShopBrandMap);

router.get("/:id", auth, requireRoles(...VIEW_ROLES), getShopBrandMapById);

router.patch("/:id", auth, requireRoles(...UPDATE_ROLES), updateShopBrandMap);

router.patch(
  "/:id/toggle-active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleShopBrandMap
);

router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deleteShopBrandMap);

export default router;
