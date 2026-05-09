import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const NOTIFICATION_TYPE = [
  "LOW_STOCK", "PENDING_APPROVAL", "NEW_ORDER", "ORDER_STATUS",
  "PAYMENT_RECEIVED", "PURCHASE_DUE", "SYSTEM", "GENERAL",
] as const;

export const NOTIFICATION_AUDIENCE = ["MASTER", "SHOP"] as const;

const NotificationSchema = new Schema(
  {
    audience: { type: String, enum: NOTIFICATION_AUDIENCE, required: true, index: true },
    recipientId: { type: Schema.Types.ObjectId, required: true, index: true },
    recipientRole: { type: String, required: true, trim: true },

    shopId: { type: Schema.Types.ObjectId, ref: "Shop", default: null, index: true },

    type: { type: String, enum: NOTIFICATION_TYPE, required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },

    refId: { type: Schema.Types.ObjectId, default: null },
    refModel: { type: String, default: "", trim: true },

    isRead: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

export type Notification = InferSchemaType<typeof NotificationSchema>;
export const NotificationModel: Model<Notification> =
  (models.Notification as Model<Notification>) || model<Notification>("Notification", NotificationSchema);

export default NotificationModel;
