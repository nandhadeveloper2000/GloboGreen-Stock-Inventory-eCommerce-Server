// src/routes/subadmin.routes.ts
import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireMaster, requireSubAdmin } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

import {
  createSubAdmin,
  deleteSubAdmin,
  getSubAdminById,
  getSubAdminMe,
  listSubAdmins,
  updateSubAdmin,
  updateSubAdminMe,
  subAdminLogin,
  subAdminLogout,
  subAdminAvatarUpload,
  subAdminAvatarRemove,
  masterSubAdminAvatarUpload,

  // ✅ add these
  subAdminRefreshToken,
  forgotSubAdminPin,
  verifySubAdminPinOtp,
  resetSubAdminPin,
  changeSubAdminPin,
} from "../controllers/subadmin.controller";

const router = Router();

const uploadFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "idproof", maxCount: 1 },
]);

/* ===================== AUTH (SUBADMIN) ===================== */
router.post("/login", subAdminLogin);
router.post("/refresh-token", subAdminRefreshToken);

// ✅ forgot/reset PIN public routes
router.post("/forgot-pin", forgotSubAdminPin);
router.post("/verify-pin-otp", verifySubAdminPinOtp);
router.post("/reset-pin", resetSubAdminPin);

router.post("/logout", auth, requireSubAdmin, subAdminLogout);

/* ===================== SUBADMIN SELF ===================== */
router.get("/me", auth, requireSubAdmin, getSubAdminMe);

// ✅ logged-in change PIN
router.put("/me/change-pin", auth, requireSubAdmin, changeSubAdminPin);

router.post(
  "/me/avatar",
  auth,
  requireSubAdmin,
  upload.single("avatar"),
  subAdminAvatarUpload
);

router.delete(
  "/me/avatar",
  auth,
  requireSubAdmin,
  subAdminAvatarRemove
);

// ✅ SELF UPDATE (name/username/email/pin/roles/mobile/additional + avatar/idproof)
router.put(
  "/me",
  auth,
  requireSubAdmin,
  uploadFields,
  updateSubAdminMe
);

/* ===================== MASTER CRUD (SUBADMINS) ===================== */
router.post("/", auth, requireMaster, uploadFields, createSubAdmin);
router.get("/", auth, requireMaster, listSubAdmins);

router.get("/:id", auth, requireMaster, getSubAdminById);

// ✅ MASTER UPDATE
router.put("/:id", auth, requireMaster, uploadFields, updateSubAdmin);

// ✅ MASTER AVATAR CHANGE
router.put(
  "/:id/avatar",
  auth,
  requireMaster,
  upload.single("avatar"),
  masterSubAdminAvatarUpload
);

router.delete("/:id", auth, requireMaster, deleteSubAdmin);

export default router;