import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  bulkCreateShopModelMaps,
  createShopModelMap,
  deleteShopModelMap,
  getShopModelMapById,
  listShopModelMaps,
  listShopModelsByShop,
  toggleShopModelMap,
  updateShopModelMap,
} from "../controllers/shopModelMap.controller";

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

router.get("/", auth, requireRoles(...VIEW_ROLES), listShopModelMaps);

router.get(
  "/shop/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  listShopModelsByShop
);

router.post(
  "/bulk",
  auth,
  requireRoles(...CREATE_ROLES),
  bulkCreateShopModelMaps
);

router.post("/", auth, requireRoles(...CREATE_ROLES), createShopModelMap);

router.get("/:id", auth, requireRoles(...VIEW_ROLES), getShopModelMapById);

router.patch("/:id", auth, requireRoles(...UPDATE_ROLES), updateShopModelMap);

router.patch(
  "/:id/toggle-active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleShopModelMap
);

router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deleteShopModelMap);

export default router;
