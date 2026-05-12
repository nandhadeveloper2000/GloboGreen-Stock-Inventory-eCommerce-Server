import { Router } from "express";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createProductType,
  deleteProductType,
  getProductType,
  listProductTypes,
  toggleProductTypeActive,
  updateProductType,
} from "../controllers/productType.controller";

const router = Router();

router.get("/", auth, listProductTypes);
router.get("/:id", auth, getProductType);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
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

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteProductType
);

export default router;
