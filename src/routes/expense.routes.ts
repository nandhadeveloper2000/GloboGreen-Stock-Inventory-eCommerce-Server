import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createExpense,
  getExpenseById,
  listExpenses,
} from "../controllers/expense.controller";

const router = Router();

const VIEW_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const CREATE_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listExpenses);
router.post("/", auth, requireRoles(...CREATE_ROLES), createExpense);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getExpenseById);

export default router;
