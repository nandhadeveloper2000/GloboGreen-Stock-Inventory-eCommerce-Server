import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";

import {
  apiCreateInvoiceFromOrder,
  createDirectPurchaseInvoice,
  listMyInvoices,
  getInvoice,
} from "../controllers/invoice.controller";

const router = Router();

/** CUSTOMER */
router.get("/my", auth, requireRoles("CUSTOMER"), listMyInvoices);

/** ADMIN/SHOP generate */
router.post(
  "/from-order/:orderId",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"),
  apiCreateInvoiceFromOrder
);

router.post(
  "/direct-purchase",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  createDirectPurchaseInvoice
);

/** view invoice */
router.get(
  "/:id",
  auth,
  requireRoles("CUSTOMER", "MASTER_ADMIN", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  getInvoice
);

export default router;
