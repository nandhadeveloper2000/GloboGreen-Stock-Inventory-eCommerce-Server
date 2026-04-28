import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createVendor,
  deleteVendor,
  getVendorById,
  listVendors,
  updateVendor,
  updateVendorStatus,
} from "../controllers/vendor.controller";

const router = Router();

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const CREATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
] as const;

const UPDATE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
] as const;

const DELETE_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
] as const;

/**
 * List vendors
 * GET /api/vendors?shopId=xxx&q=abc&status=ACTIVE
 */
router.get("/", auth, requireRoles(...VIEW_ROLES), listVendors);

/**
 * Optional shop-wise clean route
 * GET /api/vendors/shop/:shopId?q=abc&status=ACTIVE
 */
router.get("/shop/:shopId", auth, requireRoles(...VIEW_ROLES), listVendors);

/**
 * Create vendor
 * POST /api/vendors
 */
router.post("/", auth, requireRoles(...CREATE_ROLES), createVendor);

/**
 * Get single vendor
 * GET /api/vendors/:id
 */
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getVendorById);

/**
 * Update vendor
 * PUT /api/vendors/:id
 */
router.put("/:id", auth, requireRoles(...UPDATE_ROLES), updateVendor);

/**
 * Update status only
 * PATCH /api/vendors/:id/status
 */
router.patch(
  "/:id/status",
  auth,
  requireRoles(...UPDATE_ROLES),
  updateVendorStatus
);

/**
 * Soft delete vendor
 * DELETE /api/vendors/:id
 */
router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deleteVendor);

export default router;