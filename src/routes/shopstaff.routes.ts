import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

import {
  loginRateLimiter,
  refreshRateLimiter,
  forgotPinRateLimiter,
  otpVerifyRateLimiter,
} from "../middlewares/rateLimit.middleware";

import { refreshAuthSession } from "../controllers/auth.controller";

import {
  createShopStaff,
  listShopStaff,
  getShopStaff,
  updateShopStaff,
  deleteShopStaff,
  toggleShopStaffActive,
  shopStaffLogin,
  shopStaffLogout,
  forgotShopStaffPin,
  verifyShopStaffPinOtp,
  resetShopStaffPin,
  changeShopStaffPin,
  getMyShopStaffProfile,
  updateMyShopStaffProfile,
  requestShopStaffEmailOtp,
  verifyShopStaffEmailOtp,
  shopStaffAvatarUpload,
  shopStaffAvatarRemove,
  shopStaffDocsUpload,
  shopStaffDocsRemove,
} from "../controllers/shopstaff.controller";

const router = Router();

const uploadFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "idproof", maxCount: 1 },
]);

/* ===================== AUTH ===================== */
router.post("/login", loginRateLimiter, shopStaffLogin);
router.post("/refresh", refreshRateLimiter, refreshAuthSession);
router.post("/forgot-pin", forgotPinRateLimiter, forgotShopStaffPin);
router.post("/verify-pin-otp", otpVerifyRateLimiter, verifyShopStaffPinOtp);
router.post("/reset-pin", otpVerifyRateLimiter, resetShopStaffPin);

router.post(
  "/logout",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  shopStaffLogout
);

/* ===================== SELF ===================== */
router.get(
  "/me",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  getMyShopStaffProfile
);

router.put(
  "/me",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  uploadFields,
  updateMyShopStaffProfile
);

router.put(
  "/me/change-pin",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  changeShopStaffPin
);

router.post(
  "/me/request-email-otp",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  requestShopStaffEmailOtp
);

router.post(
  "/me/verify-email-otp",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  verifyShopStaffEmailOtp
);

/* ===================== SELF AVATAR ===================== */
router.put(
  "/me/avatar",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  upload.fields([{ name: "avatar", maxCount: 1 }]),
  shopStaffAvatarUpload
);

router.delete(
  "/me/avatar",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  shopStaffAvatarRemove
);

/* ===================== SELF DOCS ===================== */
router.put(
  "/me/docs",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  upload.fields([{ name: "idproof", maxCount: 1 }]),
  shopStaffDocsUpload
);

router.delete(
  "/me/docs/:key",
  auth,
  requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  shopStaffDocsRemove
);

/* ===================== CRUD ===================== */
router.post(
  "/",
  auth,
  requireRoles("SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"),
  uploadFields,
  createShopStaff
);

router.get(
  "/",
  auth,
  requireRoles("SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"),
  listShopStaff
);

router.get(
  "/:id",
  auth,
  requireRoles("SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  getShopStaff
);

router.put(
  "/:id",
  auth,
  requireRoles("SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"),
  uploadFields,
  updateShopStaff
);

router.put(
  "/:id/activate",
  auth,
  requireRoles("SHOP_OWNER"),
  toggleShopStaffActive
);

router.delete(
  "/:id",
  auth,
  requireRoles("SHOP_OWNER"),
  deleteShopStaff
);

export default router;