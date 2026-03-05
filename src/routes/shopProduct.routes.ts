import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  addProductToShop,
  listShopProducts,
  updateShopProduct,
  deactivateShopProduct,
} from "../controllers/shopProduct.controller";

const router = Router();

const VIEW_ROLES = ["MASTER_ADMIN","MANAGER","SHOP_OWNER","SHOP_MANAGER","SHOP_SUPERVISOR","EMPLOYEE"] as const;
const CREATE_ROLES = ["SHOP_OWNER","SHOP_MANAGER","SHOP_SUPERVISOR"] as const;
const DEACTIVATE_ROLES = ["SHOP_OWNER","SHOP_MANAGER"] as const;

router.get("/:shopId/products", auth, requireRoles(...VIEW_ROLES), listShopProducts);
router.post("/:shopId/products", auth, requireRoles(...CREATE_ROLES), addProductToShop);
router.put("/:shopId/products/:productId", auth, requireRoles(...CREATE_ROLES), updateShopProduct);
router.delete("/:shopId/products/:productId", auth, requireRoles(...DEACTIVATE_ROLES), deactivateShopProduct);

export default router;