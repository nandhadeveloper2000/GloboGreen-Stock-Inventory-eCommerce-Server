import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

import {
  createMasterCategory,
  listMasterCategories,
  getMasterCategory,
  updateMasterCategory,
  deleteMasterCategory,
  toggleMasterCategoryActive,
  updateMasterCategoryImage,
  removeMasterCategoryImage,
} from "../controllers/masterCategory.controller";

const router = Router();

const imageUpload = upload.single("image");

/* ===================== MASTER CATEGORY ===================== */

router.get("/", auth, listMasterCategories);
router.get("/:id", auth, getMasterCategory);
router.post("/", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), imageUpload, createMasterCategory);
router.put("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), updateMasterCategory);
router.put("/:id/active", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), toggleMasterCategoryActive);
router.post("/:id/image", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), imageUpload, updateMasterCategoryImage);
router.delete("/:id/image", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), removeMasterCategoryImage);
router.delete("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), deleteMasterCategory);

export default router;