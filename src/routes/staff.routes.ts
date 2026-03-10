import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";
import {
  createStaff,
  listStaff,
  getStaff,
  updateStaff,
  deleteStaff,
  staffLogin,
  staffLogout,
  staffRefreshToken,
  forgotStaffPin,
  verifyStaffPinOtp,
  resetStaffPin,
  changeStaffPin,
} from "../controllers/staff.controller";

const router = Router();

const uploadFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "idproof", maxCount: 1 },
]);

/* ===================== AUTH ===================== */
router.post("/login", staffLogin);
router.post("/refresh-token", staffRefreshToken);
router.post("/forgot-pin", forgotStaffPin);
router.post("/verify-pin-otp", verifyStaffPinOtp);
router.post("/reset-pin", resetStaffPin);
router.post("/logout", auth, requireRoles("STAFF", "SUPERVISOR"), staffLogout);

/* ===================== SELF ===================== */
router.put(
  "/me/change-pin",
  auth,
  requireRoles("STAFF", "SUPERVISOR"),
  changeStaffPin
);

/* ===================== CRUD ===================== */
router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER"),
  uploadFields,
  createStaff
);

router.get(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "STAFF", "SUPERVISOR"),
  listStaff
);

router.get(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "STAFF", "SUPERVISOR"),
  getStaff
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER"),
  uploadFields,
  updateStaff
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER"),
  deleteStaff
);

export default router;