import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  addProductToShop,
  listAvailableProductsForShop,
  listShopProducts,
  updateProductToShop,
  deactivateShopProduct,
} from "../controllers/shopProduct.controller";

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

const DELETE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
] as const;

router.get(
  "/:shopId/available-products",
  auth,
  requireRoles(...VIEW_ROLES),
  listAvailableProductsForShop
);

router.get(
  "/:shopId/products",
  auth,
  requireRoles(...VIEW_ROLES),
  listShopProducts
);

router.post(
  "/:shopId/products",
  auth,
  requireRoles(...CREATE_ROLES),
  addProductToShop
);

router.put(
  "/:shopId/products/:productId",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateProductToShop
);

router.delete(
  "/:shopId/products/:productId",
  auth,
  requireRoles(...DELETE_ROLES),
  deactivateShopProduct
);

export default router;
