import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import multer from "multer";

import {
  createGlobalCategory,
  createGlobalSubCategory,
  createGlobalBrand,
  listGlobalCategories,
  listGlobalSubCategories,
  listGlobalBrands,
  toggleGlobalCategoryActive,
  toggleGlobalSubCategoryActive,
  toggleGlobalBrandActive,

  updateGlobalCategoryImage,
  updateGlobalSubCategoryImage,
  updateGlobalBrandImage,
  removeGlobalCategoryImage,
} from "../controllers/catalog.controller";


const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// your latest matrix:
const VIEW_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const CREATE_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"] as const;
const DEACTIVATE_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER"] as const;

/* ---------------- CATEGORY ---------------- */
router.post("/categories", auth, requireRoles(...CREATE_ROLES), upload.single("image"), createGlobalCategory);
router.get("/categories", auth, requireRoles(...VIEW_ROLES), listGlobalCategories);
router.patch("/categories/:id/active", auth, requireRoles(...DEACTIVATE_ROLES), toggleGlobalCategoryActive);

// ✅ image endpoints
router.patch("/categories/:id/image", auth, requireRoles(...CREATE_ROLES), upload.single("image"), updateGlobalCategoryImage);
router.delete("/categories/:id/image", auth, requireRoles(...CREATE_ROLES), removeGlobalCategoryImage);

/* --------------- SUBCATEGORY -------------- */
router.post("/subcategories", auth, requireRoles(...CREATE_ROLES), upload.single("image"), createGlobalSubCategory);
router.get("/subcategories", auth, requireRoles(...VIEW_ROLES), listGlobalSubCategories);
router.patch("/subcategories/:id/active", auth, requireRoles(...DEACTIVATE_ROLES), toggleGlobalSubCategoryActive);

router.patch("/subcategories/:id/image", auth, requireRoles(...CREATE_ROLES), upload.single("image"), updateGlobalSubCategoryImage);

/* ----------------- BRAND ------------------ */
router.post("/brands", auth, requireRoles(...CREATE_ROLES), upload.single("image"), createGlobalBrand);
router.get("/brands", auth, requireRoles(...VIEW_ROLES), listGlobalBrands);
router.patch("/brands/:id/active", auth, requireRoles(...DEACTIVATE_ROLES), toggleGlobalBrandActive);

router.patch("/brands/:id/image", auth, requireRoles(...CREATE_ROLES), upload.single("image"), updateGlobalBrandImage);

export default router;
