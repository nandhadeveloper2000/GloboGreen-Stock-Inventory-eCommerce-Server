import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";

import {
  createProductCompatibility,
  listProductCompatibilities,
  getProductCompatibility,
  updateProductCompatibility,
  deleteProductCompatibility,
  toggleProductCompatibilityActive,
} from "../controllers/productCompatibility.controller";

const router = Router();

/* ---------------- LIST ---------------- */
router.get("/", auth, listProductCompatibilities);

/* ---------------- GET SINGLE ---------------- */
router.get("/:id", auth, getProductCompatibility);

/* ---------------- CREATE ---------------- */
router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  createProductCompatibility
);

/* ---------------- UPDATE ---------------- */
router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateProductCompatibility
);

/* ---------------- DELETE ---------------- */
router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteProductCompatibility
);

/* ---------------- TOGGLE ACTIVE ---------------- */
router.put(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleProductCompatibilityActive
);

export default router;