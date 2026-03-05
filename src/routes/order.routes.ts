import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";

import {
  createOrder,
  listMyOrders,
  getOrder,
  listOrders,
  cancelOrder,
  updateOrderStatus,
} from "../controllers/order.controller";

const router = Router();

/** CUSTOMER */
router.post("/", auth, requireRoles("CUSTOMER"), createOrder);
router.get("/my", auth, requireRoles("CUSTOMER"), listMyOrders);
router.put("/:id/cancel", auth, requireRoles("CUSTOMER"), cancelOrder);

/** view single */
router.get(
  "/:id",
  auth,
  requireRoles("CUSTOMER", "MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  getOrder
);

/** ADMIN/SHOP list + status update */
router.get(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"),
  listOrders
);
router.put(
  "/:id/status",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"),
  updateOrderStatus
);

export default router;