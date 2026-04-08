import { Router } from "express";
import multer from "multer";

import {
  customerRequestOtp,
  customerVerifyOtp,
  getMyCustomerProfile,
  updateMyCustomerProfile,
} from "../controllers/customer.controller";

import {
  refreshAuthSession,
  logoutAuthSession,
  logoutAllAuthSessions,
  getMyActiveSessions,
  revokeSessionBySid,
  getMeFromSession,
} from "../controllers/auth.controller";

import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  loginRateLimiter,
  refreshRateLimiter,
  otpVerifyRateLimiter,
} from "../middlewares/rateLimit.middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/* AUTH */
router.post("/auth/request-otp", loginRateLimiter, customerRequestOtp);
router.post("/auth/verify-otp", otpVerifyRateLimiter, customerVerifyOtp);
router.post("/auth/refresh", refreshRateLimiter, refreshAuthSession);

router.post("/auth/logout", auth, requireRoles("CUSTOMER"), logoutAuthSession);
router.post(
  "/auth/logout-all",
  auth,
  requireRoles("CUSTOMER"),
  logoutAllAuthSessions
);

router.get(
  "/auth/sessions",
  auth,
  requireRoles("CUSTOMER"),
  getMyActiveSessions
);

router.delete(
  "/auth/sessions/:sid",
  auth,
  requireRoles("CUSTOMER"),
  revokeSessionBySid
);

router.get("/auth/me", auth, requireRoles("CUSTOMER"), getMeFromSession);

/* CUSTOMER SELF */
router.get("/me", auth, requireRoles("CUSTOMER"), getMyCustomerProfile);
router.put(
  "/me",
  auth,
  requireRoles("CUSTOMER"),
  upload.single("avatar"),
  updateMyCustomerProfile
);

export default router;