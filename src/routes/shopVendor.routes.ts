import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  createVendor,
  deleteVendor,
  listVendors,
  updateVendor,
} from "../controllers/vendor.controller";

const router = Router({ mergeParams: true });

const VIEW_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const MANAGE_ROLES = [
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

/*
 * Frontend calls:
 *   GET    /api/shop-vendors/:shopId/vendors
 *   POST   /api/shop-vendors/:shopId/vendors
 *   PUT    /api/shop-vendors/:shopId/vendors/:vendorId
 *   DELETE /api/shop-vendors/:shopId/vendors/:vendorId
 *
 * The existing vendor controller reads shopId from req.params or req.query,
 * so we mount with mergeParams and inject shopId via the nested path.
 */

router.get("/:shopId/vendors", auth, requireRoles(...VIEW_ROLES), (req, res, next) => {
  req.query.shopId = req.params.shopId;
  next();
}, listVendors);

router.post("/:shopId/vendors", auth, requireRoles(...MANAGE_ROLES), (req, res, next) => {
  if (!req.body) req.body = {};
  req.body.shopId = req.params.shopId;
  next();
}, createVendor);

router.put("/:shopId/vendors/:vendorId", auth, requireRoles(...MANAGE_ROLES), (req, res, next) => {
  req.params.id = req.params.vendorId;
  next();
}, updateVendor);

router.delete("/:shopId/vendors/:vendorId", auth, requireRoles(...DELETE_ROLES), (req, res, next) => {
  req.params.id = req.params.vendorId;
  next();
}, deleteVendor);

export default router;
