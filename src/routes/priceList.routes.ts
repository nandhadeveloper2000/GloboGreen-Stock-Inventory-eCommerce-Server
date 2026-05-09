import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  listPriceLists,
  createPriceList,
  getPriceListById,
  updatePriceList,
  deletePriceList,
} from "../controllers/priceList.controller";

const router = Router();

const VIEW_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;
const MANAGE_ROLES = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "SHOP_OWNER", "SHOP_MANAGER"] as const;
const DELETE_ROLES = ["MASTER_ADMIN", "MANAGER", "SHOP_OWNER"] as const;

router.get("/", auth, requireRoles(...VIEW_ROLES), listPriceLists);
router.get("/:id", auth, requireRoles(...VIEW_ROLES), getPriceListById);
router.post("/", auth, requireRoles(...MANAGE_ROLES), createPriceList);
router.put("/:id", auth, requireRoles(...MANAGE_ROLES), updatePriceList);
router.delete("/:id", auth, requireRoles(...DELETE_ROLES), deletePriceList);

export default router;
