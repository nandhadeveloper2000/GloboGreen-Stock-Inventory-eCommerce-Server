import { Router } from "express";
import multer from "multer";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";

import {
  createMasterCategory,
  listMasterCategories,
  getMasterCategory,
  updateMasterCategory,
  deleteMasterCategory,
  toggleMasterCategoryActive,
  updateMasterCategoryImage,
  removeMasterCategoryImage,

  createCategory,
  listCategories,
  getCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryActive,
  updateCategoryImage,
  removeCategoryImage,

  createSubCategory,
  listSubCategories,
  getSubCategory,
  updateSubCategory,
  deleteSubCategory,
  toggleSubCategoryActive,
  updateSubCategoryImage,
  removeSubCategoryImage,

  createBrand,
  listBrands,
  getBrand,
  updateBrand,
  deleteBrand,
  toggleBrandActive,
  updateBrandImage,
  removeBrandImage,

  createModel,
  listModels,
  getModel,
  updateModel,
  deleteModel,
  toggleModelActive,
  updateModelImage,
  removeModelImage,
} from "../controllers/masterCatalog.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
] as const;

const CREATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
] as const;

const UPDATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
] as const;

const DELETE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
] as const;

/* ============================= MASTER CATEGORY ============================= */
router.post(
  "/",
  auth,
  requireRoles(...CREATE_ROLES),
  upload.single("image"),
  createMasterCategory
);

router.get(
  "/",
  auth,
  requireRoles(...VIEW_ROLES),
  listMasterCategories
);

router.get(
  "/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getMasterCategory
);

router.put(
  "/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateMasterCategory
);

router.delete(
  "/:id",
  auth,
  requireRoles(...DELETE_ROLES),
  deleteMasterCategory
);

router.put(
  "/:id/active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleMasterCategoryActive
);

router.put(
  "/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  upload.single("image"),
  updateMasterCategoryImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  removeMasterCategoryImage
);

/* ================================= CATEGORY ================================ */
router.post(
  "/categories",
  auth,
  requireRoles(...CREATE_ROLES),
  upload.single("image"),
  createCategory
);

router.get(
  "/categorieslist",
  auth,
  requireRoles(...VIEW_ROLES),
  listCategories
);

router.get(
  "/categories/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getCategory
);

router.put(
  "/categories/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateCategory
);

router.delete(
  "/categories/:id",
  auth,
  requireRoles(...DELETE_ROLES),
  deleteCategory
);

router.put(
  "/categories/:id/active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleCategoryActive
);

router.put(
  "/categories/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  upload.single("image"),
  updateCategoryImage
);

router.delete(
  "/categories/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  removeCategoryImage
);

/* =============================== SUB CATEGORY ============================== */
router.post(
  "/sub-categories",
  auth,
  requireRoles(...CREATE_ROLES),
  upload.single("image"),
  createSubCategory
);

router.get(
  "/sub-categories",
  auth,
  requireRoles(...VIEW_ROLES),
  listSubCategories
);

router.get(
  "/sub-categories/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getSubCategory
);

router.put(
  "/sub-categories/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateSubCategory
);

router.delete(
  "/sub-categories/:id",
  auth,
  requireRoles(...DELETE_ROLES),
  deleteSubCategory
);

router.put(
  "/sub-categories/:id/active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleSubCategoryActive
);

router.put(
  "/sub-categories/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  upload.single("image"),
  updateSubCategoryImage
);

router.delete(
  "/sub-categories/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  removeSubCategoryImage
);

/* ================================== BRAND ================================= */
router.post(
  "/brands",
  auth,
  requireRoles(...CREATE_ROLES),
  upload.single("image"),
  createBrand
);

router.get(
  "/brands",
  auth,
  requireRoles(...VIEW_ROLES),
  listBrands
);

router.get(
  "/brands/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getBrand
);

router.put(
  "/brands/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateBrand
);

router.delete(
  "/brands/:id",
  auth,
  requireRoles(...DELETE_ROLES),
  deleteBrand
);

router.put(
  "/brands/:id/active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleBrandActive
);

router.put(
  "/brands/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  upload.single("image"),
  updateBrandImage
);

router.delete(
  "/brands/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  removeBrandImage
);

/* ================================== MODEL ================================= */
router.post(
  "/models",
  auth,
  requireRoles(...CREATE_ROLES),
  upload.single("image"),
  createModel
);

router.get(
  "/models",
  auth,
  requireRoles(...VIEW_ROLES),
  listModels
);

router.get(
  "/models/:id",
  auth,
  requireRoles(...VIEW_ROLES),
  getModel
);

router.put(
  "/models/:id",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateModel
);

router.delete(
  "/models/:id",
  auth,
  requireRoles(...DELETE_ROLES),
  deleteModel
);

router.put(
  "/models/:id/active",
  auth,
  requireRoles(...UPDATE_ROLES),
  toggleModelActive
);

router.put(
  "/models/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  upload.single("image"),
  updateModelImage
);

router.delete(
  "/models/:id/image",
  auth,
  requireRoles(...UPDATE_ROLES),
  removeModelImage
);

export default router;