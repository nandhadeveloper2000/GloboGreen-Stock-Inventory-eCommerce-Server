import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

import {
  createCategory,
  listCategories,
  getCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryActive,
  updateCategoryImage,
  removeCategoryImage,
} from "../controllers/category.controller";

const router = Router();
const imageUpload = upload.single("image");

/* ===================== CATEGORY ===================== */

router.get("/", auth, listCategories);
router.get("/:id", auth, getCategory);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  createCategory
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateCategory
);

router.patch(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleCategoryActive
);

router.patch(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  updateCategoryImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  removeCategoryImage
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteCategory
);

export default router;