import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  listPayments,
  createPayment,
  getPaymentById,
  updatePayment,
  deletePayment,
  getPaymentSummary,
} from "../controllers/payment.controller";

const router = Router();

const VIEW_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"] as const;
const CREATE_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const UPDATE_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER"] as const;
const DELETE_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listPayments);
router.get("/summary", auth, requireRoles(...VIEW_ROLES), getPaymentSummary);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getPaymentById);
router.post("/", auth, requireRoles(...CREATE_ROLES), createPayment);
router.put("/:id", auth, requireRoles(...UPDATE_ROLES), updatePayment);
router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deletePayment);

export default router;
