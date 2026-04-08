import { Router } from "express";
import {
  masterLogin,
  masterGoogleLogin,
  masterMe,
  masterList,
  masterGetById,
  masterUpdate,
  masterDelete,
  masterAvatarRemove,
  masterAvatarUpload,
  masterForgotPin,
  masterResetPin,
  masterChangePin,
} from "../controllers/master.controller";
import { auth } from "../middlewares/auth";
import { requireRole } from "../middlewares/requireRole";
import { upload } from "../middlewares/upload";
import {
  loginRateLimiter,
  forgotPinRateLimiter,
  otpVerifyRateLimiter,
} from "../middlewares/rateLimit.middleware";

const router = Router();

/* ---------- AUTH PUBLIC ---------- */
router.post("/login", loginRateLimiter, masterLogin);
router.post("/google-login", loginRateLimiter, masterGoogleLogin);
router.post("/forgot-pin", forgotPinRateLimiter, masterForgotPin);
router.post("/reset-pin", otpVerifyRateLimiter, masterResetPin);

/* ---------- PROTECTED (MASTER) ---------- */
router.post("/change-pin", auth, requireRole("MASTER_ADMIN"), masterChangePin);
router.get("/me", auth, requireRole("MASTER_ADMIN"), masterMe);

/* ---------- AVATAR (SELF) ---------- */
router.post(
  "/me/avatar",
  auth,
  requireRole("MASTER_ADMIN"),
  upload.single("avatar"),
  masterAvatarUpload
);

router.delete(
  "/me/avatar",
  auth,
  requireRole("MASTER_ADMIN"),
  masterAvatarRemove
);

/* ---------- ADMIN CRUD ---------- */
router.get("/", auth, requireRole("MASTER_ADMIN"), masterList);
router.get("/:id", auth, requireRole("MASTER_ADMIN"), masterGetById);
router.put("/:id", auth, requireRole("MASTER_ADMIN"), masterUpdate);
router.delete("/:id", auth, requireRole("MASTER_ADMIN"), masterDelete);

export default router;