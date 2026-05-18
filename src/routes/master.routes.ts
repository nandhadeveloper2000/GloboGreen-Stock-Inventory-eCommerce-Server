import { Router } from "express";
import {
  masterLogin,
  masterGoogleLogin,
  masterMe,
  masterUpdateMe,
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
  refreshRateLimiter,
  forgotPinRateLimiter,
  otpVerifyRateLimiter,
  strictRateLimiter,
} from "../middlewares/rateLimit.middleware";
import { validateObjectId } from "../middlewares/validateObjectId";
import { validate } from "../middlewares/validate";
import {
  LoginSchema,
  ForgotPinSchema,
  VerifyOtpSchema,
  ResetPinSchema,
  ChangePinSchema,
} from "../schemas";
import { refreshAuthSession } from "../controllers/auth.controller";

const router = Router();

/* ---------- AUTH PUBLIC ---------- */
router.post("/login", loginRateLimiter, validate(LoginSchema), masterLogin);
router.post("/google-login", loginRateLimiter, masterGoogleLogin);
router.post("/refresh", refreshRateLimiter, refreshAuthSession);
router.post("/forgot-pin", forgotPinRateLimiter, validate(ForgotPinSchema), masterForgotPin);
router.post("/reset-pin", otpVerifyRateLimiter, validate(ResetPinSchema), masterResetPin);

/* ---------- PROTECTED (MASTER SELF) ---------- */
router.post("/change-pin", auth, strictRateLimiter, requireRole("MASTER_ADMIN"), validate(ChangePinSchema), masterChangePin);

router.get("/me", auth, requireRole("MASTER_ADMIN"), masterMe);
router.put("/me", auth, requireRole("MASTER_ADMIN"), masterUpdateMe);

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
router.get("/:id", auth, requireRole("MASTER_ADMIN"), validateObjectId("id"), masterGetById);
router.put("/:id", auth, requireRole("MASTER_ADMIN"), validateObjectId("id"), masterUpdate);
router.delete("/:id", auth, requireRole("MASTER_ADMIN"), validateObjectId("id"), masterDelete);

export default router;