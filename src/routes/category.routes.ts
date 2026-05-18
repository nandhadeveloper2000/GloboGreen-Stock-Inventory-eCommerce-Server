import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";
import { validateObjectId } from "../middlewares/validateObjectId";
import { validate } from "../middlewares/validate";
import { CreateCategorySchema } from "../schemas";

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
const ADMIN_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"] as const;

/* ===================== CATEGORY ===================== */

router.get("/", auth, listCategories);
router.get("/:id", auth, validateObjectId("id"), getCategory);

router.post(
  "/",
  auth,
  requireRoles(...ADMIN_ROLES),
  imageUpload,
  validate(CreateCategorySchema),
  createCategory
);

router.put(
  "/:id",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  updateCategory
);

router.put(
  "/:id/active",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  toggleCategoryActive
);

router.put(
  "/:id/image",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  imageUpload,
  updateCategoryImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  removeCategoryImage
);

router.delete(
  "/:id",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  deleteCategory
);

export default router;
