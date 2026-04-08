import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

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

/* ===================== BRAND ===================== */

router.get("/", auth, listBrands);
router.get("/:id", auth, getBrand);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  createBrand
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateBrand
);

router.put(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleBrandActive
);

router.post(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  updateBrandImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  removeBrandImage
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteBrand
);

export default router;