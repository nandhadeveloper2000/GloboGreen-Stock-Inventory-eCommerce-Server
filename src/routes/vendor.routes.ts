import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { validateObjectId } from "../middlewares/validateObjectId";
import { validate } from "../middlewares/validate";
import { requireShopAccess } from "../middlewares/requireShopAccess";
import { CreateVendorSchema, UpdateVendorSchema } from "../schemas";
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
router.get("/shop/:shopId", auth, requireRoles(...VIEW_ROLES), validateObjectId("shopId"), requireShopAccess("shopId"), listVendors);

router.post("/", auth, requireRoles(...CREATE_ROLES), validate(CreateVendorSchema), createVendor);

router.get("/:id", auth, requireRoles(...VIEW_ROLES), validateObjectId("id"), getVendorById);

router.put("/:id", auth, requireRoles(...UPDATE_ROLES), validateObjectId("id"), validate(UpdateVendorSchema), updateVendor);

router.patch("/:id/status", auth, requireRoles(...UPDATE_ROLES), validateObjectId("id"), updateVendorStatus);

router.delete("/:id", auth, requireRoles(...DELETE_ROLES), validateObjectId("id"), deleteVendor);

export default router;