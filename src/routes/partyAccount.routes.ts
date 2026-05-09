import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  listPartyAccounts,
  createPartyAccount,
  getPartyAccountById,
  updatePartyAccount,
  deletePartyAccount,
} from "../controllers/partyAccount.controller";

const router = Router();

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const MANAGE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
] as const;

const DELETE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listPartyAccounts);
router.post("/", auth, requireRoles(...MANAGE_ROLES), createPartyAccount);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getPartyAccountById);
router.put("/:id", auth, requireRoles(...MANAGE_ROLES), updatePartyAccount);
router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deletePartyAccount);

export default router;
