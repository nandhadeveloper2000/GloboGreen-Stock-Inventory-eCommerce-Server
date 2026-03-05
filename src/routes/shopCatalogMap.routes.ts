import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  addCategoryToShop,
  listShopCategories,
  addSubCategoryToShop,
  listShopSubCategories,
  addBrandToShop,
  listShopBrands,
  removeCategoryFromShop,
  removeSubCategoryFromShop,
  removeBrandFromShop,
} from "../controllers/shopCatalogMap.controller";

const router = Router();

const VIEW_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const CREATE_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"] as const;
const DEACTIVATE_ROLES = ["SHOP_OWNER", "SHOP_MANAGER"] as const;

/** ✅ CATEGORIES */
router.get("/:shopId/categories", auth, requireRoles(...VIEW_ROLES), listShopCategories);
router.post("/:shopId/categories", auth, requireRoles(...CREATE_ROLES), addCategoryToShop);
router.delete(
  "/:shopId/categories/:categoryId",
  auth,
  requireRoles(...DEACTIVATE_ROLES),
  removeCategoryFromShop
);

/** ✅ SUBCATEGORIES */
router.get("/:shopId/subcategories", auth, requireRoles(...VIEW_ROLES), listShopSubCategories);
router.post("/:shopId/subcategories", auth, requireRoles(...CREATE_ROLES), addSubCategoryToShop);
router.delete(
  "/:shopId/subcategories/:subCategoryId",
  auth,
  requireRoles(...DEACTIVATE_ROLES),
  removeSubCategoryFromShop
);

/** ✅ BRANDS */
router.get("/:shopId/brands", auth, requireRoles(...VIEW_ROLES), listShopBrands);
router.post("/:shopId/brands", auth, requireRoles(...CREATE_ROLES), addBrandToShop);
router.delete(
  "/:shopId/brands/:brandId",
  auth,
  requireRoles(...DEACTIVATE_ROLES),
  removeBrandFromShop
);

export default router;