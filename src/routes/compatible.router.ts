import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";

import {
  createCompatible,
  listCompatibles,
  getCompatible,
  updateCompatible,
  deleteCompatible,
  toggleCompatibleActive,
} from "../controllers/compatible.controller";

const router = Router();

/* ===================== COMPATIBILITY ===================== */

router.get("/", auth, listCompatibles);
router.get("/:id", auth, getCompatible);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  createCompatible
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateCompatible
);

router.put(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleCompatibleActive
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteCompatible
);

export default router;