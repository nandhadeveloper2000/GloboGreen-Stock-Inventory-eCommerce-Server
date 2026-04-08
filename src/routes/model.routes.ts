import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";

import {
  createModel,
  listModels,
  getModel,
  updateModel,
  deleteModel,
  toggleModelActive,
  updateModelImage,
  removeModelImage,
} from "../controllers/model.controller";

const router = Router();

const imageUpload = upload.single("image");

/* ===================== MODEL ===================== */

router.get("/", auth, listModels);
router.get("/:id", auth, getModel);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  createModel
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateModel
);

router.put(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleModelActive
);

router.post(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  imageUpload,
  updateModelImage
);

router.delete(
  "/:id/image",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  removeModelImage
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteModel
);

export default router;