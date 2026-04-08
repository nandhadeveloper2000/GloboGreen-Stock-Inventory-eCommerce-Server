import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

import {
  createSubCategory,
  listSubCategories,
  getSubCategory,
  updateSubCategory,
  deleteSubCategory,
  toggleSubCategoryActive,
  updateSubCategoryImage,
  removeSubCategoryImage,
} from "../controllers/subcategory.controller";

const router = Router();

const imageUpload = upload.single("image");

/* ===================== SUB CATEGORY ===================== */

router.get("/", auth, listSubCategories);
router.get("/:id", auth, getSubCategory);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  createSubCategory
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateSubCategory
);

router.put(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleSubCategoryActive
);

router.post(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  updateSubCategoryImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  removeSubCategoryImage
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteSubCategory
);

export default router;