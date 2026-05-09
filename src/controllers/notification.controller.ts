import { Request, Response } from "express";
import mongoose from "mongoose";
import { NotificationModel, NOTIFICATION_TYPE, NOTIFICATION_AUDIENCE } from "../models/notification.model";

type AuthUser = { sub?: string; id?: string; _id?: string; role?: string; shopId?: string };
type AuthedRequest = Request & { user?: AuthUser };

function norm(v: unknown) { return String(v ?? "").trim(); }
function isObjId(v: unknown) { return mongoose.Types.ObjectId.isValid(String(v)); }
function getBody(req: Request) { return (req.body ?? {}) as Record<string, unknown>; }
function getUserId(req: AuthedRequest) { return norm(req.user?.sub || req.user?.id || req.user?._id); }
function getUserRole(req: AuthedRequest) { return norm(req.user?.role).toUpperCase(); }

export async function listNotifications(req: AuthedRequest, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId || !isObjId(userId)) {
      return res.status(401).json({ success: false, message: "Login session invalid.", data: [] });
    }

    const isReadParam = req.query?.isRead;
    const limit = Math.min(Number(req.query?.limit ?? 50), 100);
    const page = Math.max(Number(req.query?.page ?? 1), 1);
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      recipientId: new mongoose.Types.ObjectId(userId),
      isActive: true,
    };

    if (isReadParam !== undefined) {
      filter.isRead = String(isReadParam) === "true";
    }

    const [rows, total] = await Promise.all([
      NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      NotificationModel.countDocuments(filter),
    ]);

    const unreadCount = await NotificationModel.countDocuments({
      recipientId: new mongoose.Types.ObjectId(userId),
      isActive: true,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      count: rows.length,
      total,
      page,
      unreadCount,
      data: rows,
    });
  } catch (error) {
    console.error("LIST_NOTIFICATIONS_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to list notifications", data: [] });
  }
}

export async function markNotificationRead(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    const userId = getUserId(req);

    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid notification id required" });
    if (!userId || !isObjId(userId)) return res.status(401).json({ success: false, message: "Login session invalid." });

    const doc = await NotificationModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), recipientId: new mongoose.Types.ObjectId(userId) },
      { $set: { isRead: true } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Notification not found" });

    return res.status(200).json({ success: true, message: "Notification marked as read", data: doc });
  } catch (error) {
    console.error("MARK_NOTIFICATION_READ_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to mark notification" });
  }
}

export async function markAllNotificationsRead(req: AuthedRequest, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId || !isObjId(userId)) return res.status(401).json({ success: false, message: "Login session invalid." });

    const result = await NotificationModel.updateMany(
      { recipientId: new mongoose.Types.ObjectId(userId), isRead: false, isActive: true },
      { $set: { isRead: true } }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("MARK_ALL_NOTIFICATIONS_READ_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to mark notifications" });
  }
}

export async function createNotification(req: AuthedRequest, res: Response) {
  try {
    const body = getBody(req);

    const audience = norm(body.audience).toUpperCase();
    if (!NOTIFICATION_AUDIENCE.includes(audience as typeof NOTIFICATION_AUDIENCE[number])) {
      return res.status(400).json({ success: false, message: `audience must be one of: ${NOTIFICATION_AUDIENCE.join(", ")}` });
    }

    const type = norm(body.type).toUpperCase();
    if (!NOTIFICATION_TYPE.includes(type as typeof NOTIFICATION_TYPE[number])) {
      return res.status(400).json({ success: false, message: `type must be one of: ${NOTIFICATION_TYPE.join(", ")}` });
    }

    const recipientId = norm(body.recipientId);
    if (!recipientId || !isObjId(recipientId)) {
      return res.status(400).json({ success: false, message: "Valid recipientId required" });
    }

    const title = norm(body.title);
    const notifBody = norm(body.body);
    if (!title || !notifBody) {
      return res.status(400).json({ success: false, message: "title and body required" });
    }

    const shopId = norm(body.shopId);
    const refId = norm(body.refId);
    const refModel = norm(body.refModel);

    const doc = await NotificationModel.create({
      audience,
      recipientId: new mongoose.Types.ObjectId(recipientId),
      recipientRole: norm(body.recipientRole),
      shopId: shopId && isObjId(shopId) ? new mongoose.Types.ObjectId(shopId) : null,
      type,
      title,
      body: notifBody,
      refId: refId && isObjId(refId) ? new mongoose.Types.ObjectId(refId) : null,
      refModel: refModel || "",
    });

    return res.status(201).json({ success: true, message: "Notification created", data: doc });
  } catch (error) {
    console.error("CREATE_NOTIFICATION_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to create notification" });
  }
}

export async function deleteNotification(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    const userId = getUserId(req);

    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid notification id required" });
    if (!userId || !isObjId(userId)) return res.status(401).json({ success: false, message: "Login session invalid." });

    const doc = await NotificationModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), recipientId: new mongoose.Types.ObjectId(userId) },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Notification not found" });

    return res.status(200).json({ success: true, message: "Notification deleted" });
  } catch (error) {
    console.error("DELETE_NOTIFICATION_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
}

export async function getUnreadCount(req: AuthedRequest, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId || !isObjId(userId)) return res.status(401).json({ success: false, message: "Login session invalid." });

    const count = await NotificationModel.countDocuments({
      recipientId: new mongoose.Types.ObjectId(userId),
      isRead: false,
      isActive: true,
    });

    return res.status(200).json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    console.error("GET_UNREAD_COUNT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to get unread count" });
  }
}
