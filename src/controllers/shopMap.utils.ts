import { Request } from "express";
import mongoose from "mongoose";

export type AuthRequest = Request & {
  user?: {
    sub?: string;
    _id?: string;
    id?: string;
    role?: string;
  };
};

export type CreatedByRef = "Master" | "Staff" | "ShopOwner" | "ShopStaff";

export type CreatedByType = "MASTER" | "MANAGER" | "SHOP_OWNER" | "SHOP_STAFF";

export type CreatedBy = {
  type: CreatedByType;
  id: string;
  role: string;
  ref: CreatedByRef;
};

export type MongoError = Error & {
  code?: number;
  keyPattern?: Record<string, number>;
  keyValue?: Record<string, unknown>;
};

export const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id));

export const norm = (value: unknown) => String(value ?? "").trim();

export function getUserId(req: AuthRequest) {
  return req.user?.sub || req.user?._id || req.user?.id || "";
}

export function getUserRole(req: AuthRequest) {
  return norm(req.user?.role).toUpperCase();
}

export function buildCreatedBy(req: AuthRequest): CreatedBy {
  const role = getUserRole(req);
  const userId = getUserId(req);

  if (!userId || !isObjectId(userId)) {
    throw new Error("Invalid user session");
  }

  if (role === "MASTER_ADMIN") {
    return {
      type: "MASTER",
      id: userId,
      role,
      ref: "Master",
    };
  }

  if (role === "MANAGER") {
    return {
      type: "MANAGER",
      id: userId,
      role,
      ref: "Staff",
    };
  }

  if (role === "SHOP_OWNER") {
    return {
      type: "SHOP_OWNER",
      id: userId,
      role,
      ref: "ShopOwner",
    };
  }

  return {
    type: "SHOP_STAFF",
    id: userId,
    role,
    ref: "ShopStaff",
  };
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

export function matchesSearch(values: unknown[], search: string) {
  const regex = new RegExp(escapeRegex(search), "i");
  return values.some((value) => regex.test(norm(value)));
}
