import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload";
import {
  createShopStaff,
  listShopStaff,
  getShopStaff,
  updateShopStaff,
  deleteShopStaff,
  shopStaffLogin,
  shopStaffRefresh,
  shopStaffLogout,
} from "../controllers/shopstaff.controller";

const router = Router();

const uploadFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "idproof", maxCount: 1 },
]);

// ✅ Auth
router.post("/login", shopStaffLogin);
router.post("/refresh", shopStaffRefresh);
router.post("/logout", auth, requireRoles("SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"), shopStaffLogout);

// ✅ CRUD (creator)
router.post("/", auth, requireRoles("SHOP_OWNER", "SHOP_MANAGER"), uploadFields, createShopStaff);
router.get("/", auth, requireRoles("SHOP_OWNER", "SHOP_MANAGER"), listShopStaff);
router.get("/:id", auth, requireRoles("SHOP_OWNER", "SHOP_MANAGER","SHOP_SUPERVISOR", "EMPLOYEE"), getShopStaff);
router.put("/:id", auth, requireRoles("SHOP_OWNER", "SHOP_MANAGER","SHOP_SUPERVISOR", "EMPLOYEE"), uploadFields, updateShopStaff);
router.delete("/:id", auth, requireRoles("SHOP_OWNER", "SHOP_MANAGER"), deleteShopStaff);

export default router;