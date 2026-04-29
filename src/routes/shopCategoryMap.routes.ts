import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  bulkCreateShopCategoryMaps,
  createShopCategoryMap,
  deleteShopCategoryMap,
  getShopCategoryMapById,
  listShopCategoryMaps,
  listShopCategoriesByShop,
  toggleShopCategoryMap,
  updateShopCategoryMap,
} from "../controllers/shopCategoryMap.controller";

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

/**
 * Important:
 * Static routes must come before "/:id"
 */

router.get("/", auth, requireRoles(...VIEW_ROLES), listShopCategoryMaps);

router.get(
  "/shop/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  listShopCategoriesByShop
);

router.post(
  "/bulk",
  auth,
  requireRoles(...CREATE_ROLES),
  bulkCreateShopCategoryMaps
);

router.post("/", auth, requireRoles(...CREATE_ROLES), createShopCategoryMap);

router.get("/:id", auth, requireRoles(...VIEW_ROLES), getShopCategoryMapById);

router.patch(
  "/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateShopCategoryMap
);

router.patch(
  "/:id/toggle-active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleShopCategoryMap
);

router.delete(
  "/:id",
  auth,
  requireRoles(...DELETE_ROLES),
  deleteShopCategoryMap
);

export default router;