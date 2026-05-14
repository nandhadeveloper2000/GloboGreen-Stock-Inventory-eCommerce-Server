import { Router } from "express";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createOrUpdateProductTypeFieldBuilder,
  deleteProductTypeFieldBuilder,
  getProductTypeFieldBuilderByProductType,
  listProductTypeFieldBuilders,
  toggleProductTypeFieldBuilderStatus,
  updateProductTypeFieldBuilder,
} from "../controllers/productTypeFieldBuilder.controller";

const router = Router();

router.get("/", auth, listProductTypeFieldBuilders);
router.get("/:productTypeId", auth, getProductTypeFieldBuilderByProductType);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  createOrUpdateProductTypeFieldBuilder
);

router.put(
  "/:productTypeId",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateProductTypeFieldBuilder
);

router.delete(
  "/:productTypeId",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteProductTypeFieldBuilder
);

router.patch(
  "/:productTypeId/status",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleProductTypeFieldBuilderStatus
);

export default router;
