import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";
import { validateObjectId } from "../middlewares/validateObjectId";
import { validate } from "../middlewares/validate";
import { CreateBrandSchema } from "../schemas";

import {
  createBrand,
  listBrands,
  getBrand,
  updateBrand,
  deleteBrand,
  toggleBrandActive,
  updateBrandImage,
  removeBrandImage,
} from "../controllers/brand.controller";

const router = Router();

const imageUpload = upload.single("image");
const ADMIN_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"] as const;

/* ===================== BRAND ===================== */

router.get("/", auth, listBrands);
router.get("/:id", auth, validateObjectId("id"), getBrand);

router.post(
  "/",
  auth,
  requireRoles(...ADMIN_ROLES),
  imageUpload,
  validate(CreateBrandSchema),
  createBrand
);

router.put(
  "/:id",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  updateBrand
);

router.put(
  "/:id/active",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  toggleBrandActive
);

router.post(
  "/:id/image",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  imageUpload,
  updateBrandImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  removeBrandImage
);

router.delete(
  "/:id",
  auth,
  requireRoles(...ADMIN_ROLES),
  validateObjectId("id"),
  deleteBrand
);

export default router;
