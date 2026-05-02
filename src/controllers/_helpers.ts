import mongoose from "mongoose";
import { Request } from "express";
import { uploadImage } from "../utils/uploadImage";
import { deleteImage } from "../utils/deleteImage";

export const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id));

export const norm = (value: unknown) => String(value ?? "").trim();
export const keyOf = (value: unknown) => norm(value).toLowerCase();

export function fileFrom(req: Request) {
  return (req as any).file as Express.Multer.File | undefined;
}

export function buildCreatedBy(user?: any) {
  if (!user?.sub || !user?.role) {
    return { type: "SYSTEM", id: null, role: "STAFF" };
  }

  const map: any = {
    MASTER_ADMIN: "MASTER",
    MANAGER: "MANAGER",
    SUPERVISOR: "SUPERVISOR",
    STAFF: "STAFF",
    SHOP_OWNER: "SHOP_OWNER",
    SHOP_MANAGER: "SHOP_STAFF",
    SHOP_SUPERVISOR: "SHOP_STAFF",
    EMPLOYEE: "SHOP_STAFF",
  };

  return {
    type: map[user.role] || "UNKNOWN",
    id: user.sub,
    role: user.role,
  };
}

export async function replaceImageAndDeleteOld(
  currentPublicId: string | undefined,
  file: Express.Multer.File,
  folder: string
) {
  const image = await uploadImage(file, folder);
  if (currentPublicId) await deleteImage(currentPublicId);
  return image;
}

export async function removeImageAndDeleteOld(
  currentPublicId: string | undefined
) {
  if (currentPublicId) await deleteImage(currentPublicId);
  return { url: "", publicId: "" };
}