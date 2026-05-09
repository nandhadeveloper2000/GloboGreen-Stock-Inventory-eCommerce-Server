import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  listDiscounts,
  createDiscount,
  getDiscountById,
  updateDiscount,
  deleteDiscount,
  validateDiscountCode,
} from "../controllers/discount.controller";

const router = Router();

const VIEW_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const MANAGE_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER"] as const;
const DELETE_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listDiscounts);
router.get("/validate", auth, requireRoles(...VIEW_ROLES), validateDiscountCode);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getDiscountById);
router.post("/", auth, requireRoles(...MANAGE_ROLES), createDiscount);
router.put("/:id", auth, requireRoles(...MANAGE_ROLES), updateDiscount);
router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deleteDiscount);

export default router;
