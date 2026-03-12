import { Router } from "express";
import {
  masterLogin,
  masterRefresh,
  masterLogout,
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

const router = Router();

/* ---------- AUTH PUBLIC ---------- */
router.post("/login", masterLogin);
router.post("/refresh", masterRefresh);
router.post("/logout", masterLogout);
router.post("/forgot-pin", masterForgotPin);
router.post("/reset-pin", masterResetPin);
router.post("/change-pin", auth, requireRole("MASTER_ADMIN"), masterChangePin);
/* ---------- PROTECTED (MASTER) ---------- */
router.get("/me", auth, masterMe);

/* ✅ AVATAR (ME) */
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

/* ---------- ADMIN CRUD (MASTER_ADMIN only) ---------- */
router.get("/", auth, requireRole("MASTER_ADMIN"), masterList);
router.get("/:id", auth, requireRole("MASTER_ADMIN"), masterGetById);
router.put("/:id", auth, requireRole("MASTER_ADMIN"), masterUpdate);
router.delete("/:id", auth, requireRole("MASTER_ADMIN"), masterDelete);

export default router;