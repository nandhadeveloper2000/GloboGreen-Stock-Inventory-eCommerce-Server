import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";
import {
  createShop,
  listShops,
  getShop,
  updateShop,
  deleteShop,
  shopFrontUpload,
  shopFrontRemove,
  adminShopFrontUpload,
  adminShopFrontRemove,
  shopDocsUpload,
  adminShopDocsUpload,
  shopDocsRemove,
  adminShopDocsRemove,
} from "../controllers/shop.controller";

const router = Router();

/* ===================== CRUD ===================== */
router.post(
  "/",
  auth,
  requireRoles(
    "MASTER_ADMIN",
    "MANAGER",
    "SUPERVISOR",
    "STAFF",
    "SHOP_OWNER"
  ),
  upload.single("frontImage"),
  createShop
);

router.get(
  "/",
  auth,
  requireRoles(
    "MASTER_ADMIN",
    "MANAGER",
    "SUPERVISOR",
    "STAFF",
    "SHOP_OWNER",
    "SHOP_MANAGER",
    "SHOP_SUPERVISOR",
    "EMPLOYEE",
    "CUSTOMER"
  ),
  listShops
);

router.get(
  "/:id",
  auth,
  requireRoles(
    "MASTER_ADMIN",
    "MANAGER",
    "SUPERVISOR",
    "STAFF",
    "SHOP_OWNER",
    "SHOP_MANAGER",
    "SHOP_SUPERVISOR",
    "EMPLOYEE",
    "CUSTOMER"
  ),
  getShop
);

router.put(
  "/:id",
  auth,
  requireRoles(
    "MASTER_ADMIN",
    "MANAGER",
    "SHOP_OWNER",
    "SHOP_MANAGER",
    "SHOP_SUPERVISOR"
  ),
  updateShop
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SHOP_OWNER"),
  deleteShop
);

/* ===================== SHOP OWNER FRONT IMAGE ===================== */
router.post(
  "/:id/front",
  auth,
  requireRoles("SHOP_OWNER"),
  upload.single("front"),
  shopFrontUpload
);

router.delete(
  "/:id/front",
  auth,
  requireRoles("SHOP_OWNER"),
  shopFrontRemove
);

/* ===================== ADMIN FRONT IMAGE ===================== */
router.post(
  "/:id/front/admin",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  upload.single("front"),
  adminShopFrontUpload
);

router.delete(
  "/:id/front/admin",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  adminShopFrontRemove
);

/* ===================== SHOP OWNER SHOP DOCS ===================== */
router.put(
  "/:id/docs",
  auth,
  requireRoles("SHOP_OWNER"),
  upload.fields([
    { name: "gstCertificate", maxCount: 1 },
    { name: "udyamCertificate", maxCount: 1 },
  ]),
  shopDocsUpload
);

router.delete(
  "/:id/docs/:key",
  auth,
  requireRoles("SHOP_OWNER"),
  shopDocsRemove
);

/* ===================== ADMIN SHOP DOCS ===================== */
router.put(
  "/:id/docs/admin",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  upload.fields([
    { name: "gstCertificate", maxCount: 1 },
    { name: "udyamCertificate", maxCount: 1 },
  ]),
  adminShopDocsUpload
);

router.delete(
  "/:id/docs/:key/admin",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  adminShopDocsRemove
);

export default router;