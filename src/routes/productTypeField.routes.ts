import { Router } from "express";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createProductTypeFields,
  deleteProductTypeFields,
  getProductTypeFields,
  getProductTypeFieldsByProductType,
  toggleProductTypeFieldStatus,
  updateProductTypeFields,
} from "../controllers/productTypeField.controller";

const router = Router();

router.get("/", auth, getProductTypeFields);
router.get(
  "/product-type/:productTypeId",
  auth,
  getProductTypeFieldsByProductType
);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  createProductTypeFields
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateProductTypeFields
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteProductTypeFields
);

router.patch(
  "/:id/status",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleProductTypeFieldStatus
);

export default router;
