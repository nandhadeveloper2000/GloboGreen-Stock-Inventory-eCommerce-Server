import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

import {
  createProductType,
  listProductTypes,
  getProductType,
  updateProductType,
  deleteProductType,
  toggleProductTypeActive,
  updateProductTypeImage,
  removeProductTypeImage,
} from "../controllers/productType.controller";

const router = Router();
const imageUpload = upload.single("image");

router.get("/", auth, listProductTypes);
router.get("/:id", auth, getProductType);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  createProductType
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateProductType
);

router.put(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleProductTypeActive
);

router.put(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  updateProductTypeImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  removeProductTypeImage
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteProductType
);

export default router;