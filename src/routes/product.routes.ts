import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/product.controller";

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

const DELETE_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listProducts);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getProductById);
router.post("/", auth, requireRoles(...CREATE_ROLES), createProduct);
router.put("/:id", auth, requireRoles(...UPDATE_ROLES), updateProduct);
router.put("/:id", auth, requireRoles(...UPDATE_ROLES), updateProduct);
router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deleteProduct);

export default router;
