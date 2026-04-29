import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  bulkCreateShopSubCategoryMaps,
  createShopSubCategoryMap,
  deleteShopSubCategoryMap,
  getShopSubCategoryMapById,
  listShopSubCategoriesByShop,
  listShopSubCategoryMaps,
  toggleShopSubCategoryMap,
  updateShopSubCategoryMap,
} from "../controllers/shopSubCategoryMap.controller";

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

router.get("/", auth, requireRoles(...VIEW_ROLES), listShopSubCategoryMaps);

router.get(
  "/shop/:shopId",
  auth,
  requireRoles(...VIEW_ROLES),
  listShopSubCategoriesByShop
);

router.post(
  "/bulk",
  auth,
  requireRoles(...CREATE_ROLES),
  bulkCreateShopSubCategoryMaps
);

router.post(
  "/",
  auth,
  requireRoles(...CREATE_ROLES),
  createShopSubCategoryMap
);

router.get(
  "/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getShopSubCategoryMapById
);

router.patch(
  "/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateShopSubCategoryMap
);

router.patch(
  "/:id/toggle-active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleShopSubCategoryMap
);

router.delete(
  "/:id",
  auth,
  requireRoles(...DELETE_ROLES),
  deleteShopSubCategoryMap
);

export default router;
