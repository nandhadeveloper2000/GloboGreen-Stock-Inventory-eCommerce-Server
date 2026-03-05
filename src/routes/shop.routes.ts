import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
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
} from "../controllers/shop.controller";

const router = Router();

/* ===================== ADMIN CRUD ===================== */
router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF", "SHOP_OWNER"),
  upload.single("frontImage"), 
  createShop
);

router.get("/", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF", "SHOP_OWNER"), listShops);
router.get("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF", "SHOP_OWNER"), getShop);

router.put("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SHOP_OWNER"), updateShop);
router.delete("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SHOP_OWNER"), deleteShop);

/* ===================== SHOP FRONT IMAGE ===================== */
/** SHOP_OWNER: only for own shop */
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

/** ADMIN/STAFF: can update any shop */
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

export default router;