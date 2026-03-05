import { Router } from "express";
import multer from "multer";

import {
  createCustomer,
  listCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
} from "../controllers/customer.controller";

import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const STAFF_ROLES = ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const ADMIN_ROLES = ["SHOP_OWNER", "SHOP_MANAGER"] as const;

/* STAFF can view + update */
router.get("/", auth, requireRoles(...STAFF_ROLES), listCustomers);
router.get("/:id", auth, requireRoles(...STAFF_ROLES), getCustomer);
router.put("/:id", auth, requireRoles(...STAFF_ROLES), upload.single("avatar"), updateCustomer);

/* Only OWNER/MANAGER can create/delete */
router.post("/", auth, requireRoles(...ADMIN_ROLES), upload.single("avatar"), createCustomer);
router.delete("/:id", auth, requireRoles(...ADMIN_ROLES), deleteCustomer);

export default router;