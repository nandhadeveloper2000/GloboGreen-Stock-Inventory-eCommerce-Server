import { Router } from "express";
import multer from "multer";

import {
  createCustomer,
  listCustomers,
  getCustomer,
  getCustomerLedger,
  updateCustomer,
  deleteCustomer,
} from "../controllers/customer.controller";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const STAFF_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const CREATE_ROLES = [
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;
const DELETE_ROLES = ["SHOP_OWNER", "SHOP_MANAGER"] as const;

/* STAFF can view + update */
router.get("/", auth, requireRoles(...STAFF_ROLES), listCustomers);
router.get("/:id/ledger", auth, requireRoles(...STAFF_ROLES), getCustomerLedger);
router.get("/:id", auth, requireRoles(...STAFF_ROLES), getCustomer);
router.put("/:id", auth, requireRoles(...STAFF_ROLES), upload.single("avatar"), updateCustomer);

/* Sales and support staff can create customers, only owner/manager can delete */
router.post("/", auth, requireRoles(...CREATE_ROLES), upload.single("avatar"), createCustomer);
router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deleteCustomer);

export default router;
