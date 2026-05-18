import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { validateObjectId } from "../middlewares/validateObjectId";
import { validate } from "../middlewares/validate";
import { CreateStockTransferSchema } from "../schemas";
import {
  createStockTransfer,
  getStockTransfer,
  listStockTransfers,
} from "../controllers/stockTransfer.controller";

const router = Router();

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const CREATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listStockTransfers);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), validateObjectId("id"), getStockTransfer);
router.post("/", auth, requireRoles(...CREATE_ROLES), validate(CreateStockTransferSchema), createStockTransfer);

export default router;
