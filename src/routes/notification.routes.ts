import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createNotification,
  deleteNotification,
  getUnreadCount,
} from "../controllers/notification.controller";

const router = Router();

const ALL_ROLES = [
  "MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF",
  "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE",
] as const;

const SYSTEM_ROLES = ["MASTER_ADMIN", "MANAGER"] as const;

router.get("/", auth, requireRoles(...ALL_ROLES), listNotifications);
router.get("/unread-count", auth, requireRoles(...ALL_ROLES), getUnreadCount);
router.patch("/read-all", auth, requireRoles(...ALL_ROLES), markAllNotificationsRead);
router.patch("/:id/read", auth, requireRoles(...ALL_ROLES), markNotificationRead);
router.post("/", auth, requireRoles(...SYSTEM_ROLES), createNotification);
router.delete("/:id", auth, requireRoles(...ALL_ROLES), deleteNotification);

export default router;
