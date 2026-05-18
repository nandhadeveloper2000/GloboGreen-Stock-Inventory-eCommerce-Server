import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";
import {
  loginRateLimiter,
  refreshRateLimiter,
  forgotPinRateLimiter,
  otpVerifyRateLimiter,
  strictRateLimiter,
  otpResendRateLimiter,
} from "../middlewares/rateLimit.middleware";
import { validateObjectId } from "../middlewares/validateObjectId";
import { validate } from "../middlewares/validate";
import {
  LoginSchema,
  ForgotPinSchema,
  ResetPinSchema,
  ChangePinSchema,
  CreateShopOwnerSchema,
  UpdateShopOwnerSchema,
} from "../schemas";
import { refreshAuthSession } from "../controllers/auth.controller";
import {
  createShopOwner,
  listShopOwners,
  getShopOwner,
  updateShopOwner,
  updateShopOwnerMe,
  deleteShopOwner,
  toggleShopOwnerActive,
  shopOwnerLogin,
  shopOwnerLogout,
  getShopOwnerMe,
  shopOwnerAvatarUpload,
  shopOwnerAvatarRemove,
  shopOwnerDocsUpload,
  shopOwnerDocsRemove,
  masterShopOwnerAvatarUpload,
  masterShopOwnerAvatarRemove,
  masterShopOwnerDocsUpload,
  masterShopOwnerDocsRemove,
  forgotShopOwnerPin,
  verifyShopOwnerPinOtp,
  resetShopOwnerPin,
  changeShopOwnerPin,
  requestShopOwnerEmailOtp,
  verifyShopOwnerEmailOtp,
} from "../controllers/shopowner.controller";

const router = Router();

/* ===================== PUBLIC AUTH ===================== */
router.post("/login", loginRateLimiter, validate(LoginSchema), shopOwnerLogin);
router.post("/refresh", refreshRateLimiter, refreshAuthSession);
router.post("/forgot-pin", forgotPinRateLimiter, validate(ForgotPinSchema), forgotShopOwnerPin);
router.post("/verify-pin-otp", otpVerifyRateLimiter, verifyShopOwnerPinOtp);
router.post("/reset-pin", otpVerifyRateLimiter, validate(ResetPinSchema), resetShopOwnerPin);

/* ===================== SELF ===================== */
router.post(
  "/logout",
  auth,
  requireRoles("SHOP_OWNER"),
  shopOwnerLogout
);

router.get(
  "/me",
  auth,
  requireRoles("SHOP_OWNER"),
  getShopOwnerMe
);

router.put(
  "/me",
  auth,
  requireRoles("SHOP_OWNER"),
  updateShopOwnerMe
);

router.put(
  "/me/change-pin",
  auth,
  strictRateLimiter,
  requireRoles("SHOP_OWNER"),
  validate(ChangePinSchema),
  changeShopOwnerPin
);

router.post(
  "/me/request-email-otp",
  auth,
  otpResendRateLimiter,
  requireRoles("SHOP_OWNER"),
  requestShopOwnerEmailOtp
);

router.post(
  "/me/verify-email-otp",
  auth,
  requireRoles("SHOP_OWNER"),
  verifyShopOwnerEmailOtp
);

router.post(
  "/me/avatar",
  auth,
  requireRoles("SHOP_OWNER"),
  upload.single("avatar"),
  shopOwnerAvatarUpload
);

router.delete(
  "/me/avatar",
  auth,
  requireRoles("SHOP_OWNER"),
  shopOwnerAvatarRemove
);

router.put(
  "/me/docs",
  auth,
  requireRoles("SHOP_OWNER"),
  upload.fields([{ name: "idProof", maxCount: 1 }]),
  shopOwnerDocsUpload
);

router.delete(
  "/me/docs/:key",
  auth,
  requireRoles("SHOP_OWNER"),
  shopOwnerDocsRemove
);

/* ===================== ADMIN CREATE ===================== */
router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  validate(CreateShopOwnerSchema),
  createShopOwner
);

/* ===================== ADMIN ACTIVE TOGGLE ===================== */
router.put(
  "/:id/activate",
  auth,
  requireRoles("MASTER_ADMIN"),
  validateObjectId("id"),
  toggleShopOwnerActive
);

/* ===================== ADMIN CRUD ===================== */
router.get(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  listShopOwners
);

router.get(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  validateObjectId("id"),
  getShopOwner
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  validateObjectId("id"),
  validate(UpdateShopOwnerSchema),
  updateShopOwner
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  validateObjectId("id"),
  deleteShopOwner
);

/* ===================== ADMIN AVATAR ===================== */
router.put(
  "/:id/avatar",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  upload.single("avatar"),
  masterShopOwnerAvatarUpload
);

router.delete(
  "/:id/avatar",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  masterShopOwnerAvatarRemove
);

/* ===================== ADMIN ID PROOF ===================== */
router.put(
  "/:id/docs",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  upload.fields([{ name: "idProof", maxCount: 1 }]),
  masterShopOwnerDocsUpload
);

router.delete(
  "/:id/docs/:key",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  masterShopOwnerDocsRemove
);

export default router;