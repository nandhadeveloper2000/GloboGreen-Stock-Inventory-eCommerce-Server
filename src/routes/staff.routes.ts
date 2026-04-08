import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";
import {
  loginRateLimiter,
  forgotPinRateLimiter,
  otpVerifyRateLimiter,
} from "../middlewares/rateLimit.middleware";
import {
  createStaff,
  listStaff,
  getStaff,
  updateStaff,
  deleteStaff,
  staffLogin,
  forgotStaffPin,
  verifyStaffPinOtp,
  resetStaffPin,
  changeStaffPin,
  getMyStaffProfile,
  updateMyStaffProfile,
  uploadMyStaffAvatar,
  removeMyStaffAvatar,
  uploadMyStaffIdProof,
  removeMyStaffIdProof,
  removeStaffAvatar,
  removeStaffIdProof,
  toggleStaffActive,
} from "../controllers/staff.controller";

const router = Router();

const uploadFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "idproof", maxCount: 1 },
]);

const avatarUpload = upload.single("avatar");
const idProofUpload = upload.single("idproof");

/* ===================== AUTH ===================== */
router.post("/login", loginRateLimiter, staffLogin);
router.post("/forgot-pin", forgotPinRateLimiter, forgotStaffPin);
router.post("/verify-pin-otp", otpVerifyRateLimiter, verifyStaffPinOtp);
router.post("/reset-pin", otpVerifyRateLimiter, resetStaffPin);

/* ===================== SELF ===================== */
router.get(
  "/me",
  auth,
  requireRoles("MANAGER", "SUPERVISOR", "STAFF"),
  getMyStaffProfile
);

router.put(
  "/me",
  auth,
  requireRoles("MANAGER", "SUPERVISOR", "STAFF"),
  updateMyStaffProfile
);

router.post(
  "/me/avatar",
  auth,
  requireRoles("MANAGER", "SUPERVISOR", "STAFF"),
  avatarUpload,
  uploadMyStaffAvatar
);

router.delete(
  "/me/avatar",
  auth,
  requireRoles("MANAGER", "SUPERVISOR", "STAFF"),
  removeMyStaffAvatar
);

router.post(
  "/me/idproof",
  auth,
  requireRoles("MANAGER", "SUPERVISOR", "STAFF"),
  idProofUpload,
  uploadMyStaffIdProof
);

router.delete(
  "/me/idproof",
  auth,
  requireRoles("MANAGER", "SUPERVISOR", "STAFF"),
  removeMyStaffIdProof
);

router.put(
  "/me/change-pin",
  auth,
  requireRoles("MANAGER", "SUPERVISOR", "STAFF"),
  changeStaffPin
);

/* ===================== CRUD ===================== */
router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  uploadFields,
  createStaff
);

router.get(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  listStaff
);

router.get(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  getStaff
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  uploadFields,
  updateStaff
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  deleteStaff
);

router.delete(
  "/:id/avatar",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  removeStaffAvatar
);

router.delete(
  "/:id/idproof",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  removeStaffIdProof
);

router.put(
  "/:id/activate",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR"),
  toggleStaffActive
);

export default router;