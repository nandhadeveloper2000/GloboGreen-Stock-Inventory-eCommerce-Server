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
} from "../controllers/staff.controller";

const router = Router();

const uploadFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "idproof", maxCount: 1 },
]);

// ✅ AUTH
router.post("/login", staffLogin);
router.post("/logout", auth, requireRoles("STAFF", "SUPERVISOR"), staffLogout); // adjust allowed roles

// ✅ CRUD (MASTER + MANAGER only)
router.post("/", auth, requireRoles("MASTER_ADMIN", "MANAGER"), uploadFields, createStaff);
router.get("/", auth, requireRoles("MASTER_ADMIN", "MANAGER"), listStaff);
router.get("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "STAFF", "SUPERVISOR"), getStaff);
router.put("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "STAFF", "SUPERVISOR"), uploadFields, updateStaff);
router.delete("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER"), deleteStaff);

export default router;