import { Router } from "express";
import multer from "multer";

import {
  customerRequestOtp,
  customerVerifyOtp,
  customerRefresh,
  customerLogout,
  getMyCustomerProfile,
  updateMyCustomerProfile,
} from "../controllers/customer.controller";

import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/* AUTH */
router.post("/auth/request-otp", customerRequestOtp);
router.post("/auth/verify-otp", customerVerifyOtp);
router.post("/auth/refresh", customerRefresh);
router.post("/auth/logout", auth, requireRoles("CUSTOMER"), customerLogout);

/* CUSTOMER SELF */
router.get("/me", auth, requireRoles("CUSTOMER"), getMyCustomerProfile);
router.put("/me", auth, requireRoles("CUSTOMER"), upload.single("avatar"), updateMyCustomerProfile);

export default router;