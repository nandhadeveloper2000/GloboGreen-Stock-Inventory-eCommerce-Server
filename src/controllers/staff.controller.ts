import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";

import { StaffModel } from "../models/staff.model";
import cloudinary, { cloudinaryDelete } from "../config/cloudinary";
import { hashPin } from "../utils/pin";
import { sendStaffPinResetOtpEmail } from "../utils/pinResetEmails";
import type { Role } from "../utils/jwt";
import {
  createLoginSession,
  revokeAllUserSessions,
} from "./auth.controller";
import {
  assertLoginNotBlocked,
  registerLoginFailure,
  clearLoginFailures,
} from "../utils/loginProtection";

type JwtUser = {
  sub?: string;
  id?: string;
  role?: "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR" | "STAFF";
};

type StaffAppRole = "MANAGER" | "SUPERVISOR" | "STAFF";
type CreatorRole = "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR";

type StaffDocError = {
  error: {
    status: number;
    message: string;
  };
};

type StaffDocSuccess = {
  user: JwtUser & {
    sub: string;
    role: StaffAppRole;
  };
  doc: any;
};

type StaffDocResult = StaffDocError | StaffDocSuccess;

const CLOUD_FOLDER_STAFF_AVATAR = "Shop Stack/staff/avatar";
const CLOUD_FOLDER_STAFF_IDPROOF = "Shop Stack/staff/idproof";

const SELF_ALLOWED_ROLES: readonly StaffAppRole[] = [
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
] as const;

const MUTATION_ALLOWED_ROLES: readonly CreatorRole[] = [
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
] as const;

const STAFF_ALLOWED_ROLES: readonly StaffAppRole[] = [
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
] as const;

const STAFF_AUTH_SELECT =
  "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt";

/* ---------------- utility helpers ---------------- */

function safe(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;

  delete o.pinHash;
  delete o.pinResetOtpHash;
  delete o.pinResetOtpExpiresAt;
  delete o.pinResetAttempts;
  delete o.pinResetTokenHash;
  delete o.pinResetTokenExpiresAt;

  return o;
}

function getAuthUser(req: Request): JwtUser {
  return ((req as any).user || {}) as JwtUser;
}

function isObjectId(id: unknown) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

function normLower(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function normTrim(v: unknown) {
  return String(v ?? "").trim();
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  return String(value ?? "").trim().toLowerCase() === "true";
}

function getRoleValue(
  value: unknown,
  fallback: StaffAppRole = "STAFF"
): StaffAppRole {
  const role = String(value ?? fallback).trim().toUpperCase();
  return STAFF_ALLOWED_ROLES.includes(role as StaffAppRole)
    ? (role as StaffAppRole)
    : fallback;
}

function buildCreatedBy(u: JwtUser) {
  if (!u?.sub || !u?.role) {
    throw new Error("Unauthorized");
  }

  if (u.role === "MASTER_ADMIN") {
    return {
      type: "MASTER" as const,
      id: u.sub,
      role: "MASTER_ADMIN" as const,
      ref: "Master" as const,
    };
  }

  if (u.role === "MANAGER") {
    return {
      type: "MANAGER" as const,
      id: u.sub,
      role: "MANAGER" as const,
      ref: "SubAdmin" as const,
    };
  }

  if (u.role === "SUPERVISOR") {
    return {
      type: "SUPERVISOR" as const,
      id: u.sub,
      role: "SUPERVISOR" as const,
      ref: "Supervisor" as const,
    };
  }

  throw new Error("Forbidden");
}

function getCreatedById(staffDoc: any) {
  return (
    staffDoc?.createdBy?.id?.toString?.() ??
    String(staffDoc?.createdBy?.id || "")
  );
}

function getCreatedByRole(staffDoc: any) {
  return String(staffDoc?.createdBy?.role || "").trim().toUpperCase();
}

function getStaffRole(doc: any): StaffAppRole {
  return getRoleValue(doc?.role, "STAFF");
}

function clearPinResetState(doc: any) {
  doc.pinResetOtpHash = "";
  doc.pinResetOtpExpiresAt = null;
  doc.pinResetAttempts = 0;
  doc.pinResetTokenHash = "";
  doc.pinResetTokenExpiresAt = null;
}

function buildLoginLookup(loginValue: unknown) {
  const raw = normTrim(loginValue);
  const lower = raw.toLowerCase();

  return {
    raw,
    lower,
    query: {
      $or: [{ email: lower }, { username: lower }, { mobile: raw }],
    },
  };
}

async function findStaffByLogin(loginValue: unknown, select = "") {
  const lookup = buildLoginLookup(loginValue);
  return StaffModel.findOne(lookup.query).select(select);
}

function buildDuplicateOr(input: {
  email?: unknown;
  username?: unknown;
  mobile?: unknown;
  additionalNumber?: unknown;
}) {
  const nEmail = normLower(input.email);
  const nUsername = normLower(input.username);
  const nMobile = normTrim(input.mobile);
  const nAdditional = normTrim(input.additionalNumber);

  const or: any[] = [];
  if (nEmail) or.push({ email: nEmail });
  if (nUsername) or.push({ username: nUsername });
  if (nMobile) or.push({ mobile: nMobile });
  if (nAdditional) or.push({ additionalNumber: nAdditional });

  return { nEmail, nUsername, nMobile, nAdditional, or };
}

function conflictMessage(
  exists: any,
  n: ReturnType<typeof buildDuplicateOr>
) {
  const conflicts: string[] = [];

  if (n.nEmail && exists?.email === n.nEmail) conflicts.push("email");
  if (n.nUsername && exists?.username === n.nUsername) {
    conflicts.push("username");
  }
  if (n.nMobile && exists?.mobile === n.nMobile) conflicts.push("mobile");
  if (n.nAdditional && exists?.additionalNumber === n.nAdditional) {
    conflicts.push("additionalNumber");
  }

  return `Already exists: ${conflicts.join(", ") || "duplicate"}`;
}

async function validateDuplicateStaff(
  input: {
    email?: unknown;
    username?: unknown;
    mobile?: unknown;
    additionalNumber?: unknown;
  },
  excludeId?: string
) {
  const dup = buildDuplicateOr(input);

  if (!dup.or.length) {
    return { dup, exists: null };
  }

  const filter: any = { $or: dup.or };
  if (excludeId && isObjectId(excludeId)) {
    filter._id = { $ne: excludeId };
  }

  const exists = await StaffModel.findOne(filter).select(
    "_id email username mobile additionalNumber"
  );

  return { dup, exists };
}

function buildAddressPayload(body: any) {
  return {
    state: normTrim(body?.state),
    district: normTrim(body?.district),
    taluk: normTrim(body?.taluk),
    area: normTrim(body?.area),
    street: normTrim(body?.street),
    pincode: normTrim(body?.pincode),
  };
}

function applyAddress(doc: any, body: any) {
  if (!doc.address) doc.address = {} as any;

  if (body?.state !== undefined) doc.address.state = normTrim(body.state);
  if (body?.district !== undefined) doc.address.district = normTrim(body.district);
  if (body?.taluk !== undefined) doc.address.taluk = normTrim(body.taluk);
  if (body?.area !== undefined) doc.address.area = normTrim(body.area);
  if (body?.street !== undefined) doc.address.street = normTrim(body.street);
  if (body?.pincode !== undefined) doc.address.pincode = normTrim(body.pincode);
}

function canMutate(u: JwtUser, staffDoc: any) {
  if (!u?.role || !u?.sub) return false;

  if (u.role === "MASTER_ADMIN") return true;

  const createdById = getCreatedById(staffDoc);
  const createdByRole = getCreatedByRole(staffDoc);

  if (u.role === "MANAGER") {
    return createdByRole === "MANAGER" && createdById === u.sub;
  }

  if (u.role === "SUPERVISOR") {
    return createdByRole === "SUPERVISOR" && createdById === u.sub;
  }

  return false;
}

function canView(u: JwtUser, staffDoc: any) {
  if (!u?.role || !u?.sub) return false;

  if (u.role === "MASTER_ADMIN") return true;

  const createdById = getCreatedById(staffDoc);
  const createdByRole = getCreatedByRole(staffDoc);

  if (u.role === "MANAGER") {
    return createdByRole === "MANAGER" && createdById === u.sub;
  }

  if (u.role === "SUPERVISOR") {
    return createdByRole === "SUPERVISOR" && createdById === u.sub;
  }

  if (SELF_ALLOWED_ROLES.includes(u.role as StaffAppRole)) {
    return String(staffDoc?._id) === String(u.sub);
  }

  return false;
}

function generateOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += Math.floor(Math.random() * 10).toString();
  }
  return otp;
}

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function hashText(value: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(value, salt);
}

async function uploadToCloud(file: Express.Multer.File, folder: string) {
  if (!file?.buffer) {
    throw new Error("File buffer missing. Ensure multer uses memoryStorage().");
  }

  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}

async function safeCloudDelete(publicId?: string) {
  const pid = normTrim(publicId);
  if (!pid) return;

  try {
    await cloudinaryDelete(pid);
  } catch {
    // ignore cleanup failure
  }
}

function getUploadFiles(req: Request) {
  const files = req.files as { [key: string]: Express.Multer.File[] } | undefined;

  return {
    avatarFile: files?.avatar?.[0],
    idProofFile: files?.idproof?.[0],
  };
}

function hasStaffDocError(result: StaffDocResult): result is StaffDocError {
  return "error" in result;
}

async function getMyStaffDocOrThrow(
  req: Request,
  includeAuthFields = false
): Promise<StaffDocResult> {
  const u = getAuthUser(req);

  if (!u?.sub || !u?.role) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  if (!SELF_ALLOWED_ROLES.includes(u.role as StaffAppRole)) {
    return { error: { status: 403, message: "Forbidden" } };
  }

  const query = StaffModel.findById(u.sub);

  if (includeAuthFields) {
    query.select(STAFF_AUTH_SELECT);
  }

  const doc = await query;

  if (!doc) {
    return { error: { status: 404, message: "Profile not found" } };
  }

  return {
    user: {
      ...u,
      sub: u.sub,
      role: u.role as StaffAppRole,
    },
    doc,
  };
}

function handleMongoDuplicateError(err: any, res: Response) {
  if (err?.code === 11000) {
    const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
    return res.status(409).json({
      success: false,
      message: `${key} already exists`,
    });
  }

  return null;
}

async function revokeStaffSessions(doc: any) {
  await revokeAllUserSessions(String(doc._id), getStaffRole(doc) as Role);
}

/* ---------------- SELF PROFILE ---------------- */

export async function getMyStaffProfile(req: Request, res: Response) {
  try {
    const result = await getMyStaffDocOrThrow(req);

    if (hasStaffDocError(result)) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    return res.json({
      success: true,
      data: safe(result.doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function updateMyStaffProfile(req: Request, res: Response) {
  try {
    const result = await getMyStaffDocOrThrow(req);

    if (hasStaffDocError(result)) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const { doc } = result;

    const {
      name,
      username,
      email,
      mobile,
      additionalNumber,
    } = req.body as any;

    const { dup, exists } = await validateDuplicateStaff(
      {
        email: email !== undefined ? email : doc.email,
        username: username !== undefined ? username : doc.username,
        mobile: mobile !== undefined ? mobile : doc.mobile,
        additionalNumber:
          additionalNumber !== undefined ? additionalNumber : doc.additionalNumber,
      },
      String(doc._id)
    );

    if (exists) {
      return res.status(409).json({
        success: false,
        message: conflictMessage(exists, dup),
      });
    }

    if (name !== undefined) doc.name = normTrim(name);
    if (username !== undefined) doc.username = normLower(username);
    if (email !== undefined) doc.email = normLower(email);
    if (mobile !== undefined) doc.mobile = normTrim(mobile);
    if (additionalNumber !== undefined) {
      doc.additionalNumber = normTrim(additionalNumber);
    }

    applyAddress(doc, req.body);

    await doc.save();

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    const duplicateError = handleMongoDuplicateError(err, res);
    if (duplicateError) return duplicateError;

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function uploadMyStaffAvatar(req: Request, res: Response) {
  try {
    const result = await getMyStaffDocOrThrow(req);

    if (hasStaffDocError(result)) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const { doc } = result;
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Avatar file required",
      });
    }

    await safeCloudDelete(doc.avatarPublicId);

    const uploaded = await uploadToCloud(file, CLOUD_FOLDER_STAFF_AVATAR);
    doc.avatarUrl = uploaded.url;
    doc.avatarPublicId = uploaded.publicId;

    await doc.save();

    return res.json({
      success: true,
      message: "Avatar uploaded successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function removeMyStaffAvatar(req: Request, res: Response) {
  try {
    const result = await getMyStaffDocOrThrow(req);

    if (hasStaffDocError(result)) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const { doc } = result;

    await safeCloudDelete(doc.avatarPublicId);

    doc.avatarUrl = "";
    doc.avatarPublicId = "";

    await doc.save();

    return res.json({
      success: true,
      message: "Avatar removed successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function uploadMyStaffIdProof(req: Request, res: Response) {
  try {
    const result = await getMyStaffDocOrThrow(req);

    if (hasStaffDocError(result)) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const { doc } = result;
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "ID proof file required",
      });
    }

    await safeCloudDelete(doc.idProofPublicId);

    const uploaded = await uploadToCloud(file, CLOUD_FOLDER_STAFF_IDPROOF);
    doc.idProofUrl = uploaded.url;
    doc.idProofPublicId = uploaded.publicId;

    await doc.save();

    return res.json({
      success: true,
      message: "ID proof uploaded successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function removeMyStaffIdProof(req: Request, res: Response) {
  try {
    const result = await getMyStaffDocOrThrow(req);

    if (hasStaffDocError(result)) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const { doc } = result;

    await safeCloudDelete(doc.idProofPublicId);

    doc.idProofUrl = "";
    doc.idProofPublicId = "";

    await doc.save();

    return res.json({
      success: true,
      message: "ID proof removed successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ---------------- CRUD ---------------- */

export async function createStaff(req: Request, res: Response) {
  let uploadedAvatarPublicId = "";
  let uploadedIdProofPublicId = "";

  try {
    const u = getAuthUser(req);

    if (!u?.sub || !u?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!MUTATION_ALLOWED_ROLES.includes(u.role as CreatorRole)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(u.sub)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const {
      name,
      username,
      email,
      pin,
      mobile,
      additionalNumber,
      role,
    } = req.body as any;

    if (!name || !username || !email || !pin) {
      return res.status(400).json({
        success: false,
        message: "name, username, email, pin required",
      });
    }

    const pinValue = normTrim(pin);
    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    const staffRole = getRoleValue(role, "STAFF");

    const { dup, exists } = await validateDuplicateStaff({
      email,
      username,
      mobile,
      additionalNumber,
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: conflictMessage(exists, dup),
      });
    }

    const { avatarFile, idProofFile } = getUploadFiles(req);

    let avatarUrl = "";
    let idProofUrl = "";

    if (avatarFile) {
      const uploaded = await uploadToCloud(avatarFile, CLOUD_FOLDER_STAFF_AVATAR);
      avatarUrl = uploaded.url;
      uploadedAvatarPublicId = uploaded.publicId;
    }

    if (idProofFile) {
      const uploaded = await uploadToCloud(idProofFile, CLOUD_FOLDER_STAFF_IDPROOF);
      idProofUrl = uploaded.url;
      uploadedIdProofPublicId = uploaded.publicId;
    }

    const doc = await StaffModel.create({
      name: normTrim(name),
      username: dup.nUsername || normLower(username),
      email: dup.nEmail || normLower(email),
      pinHash: await hashPin(pinValue),
      role: staffRole,
      mobile: dup.nMobile || "",
      additionalNumber: dup.nAdditional || "",
      avatarUrl,
      avatarPublicId: uploadedAvatarPublicId,
      idProofUrl,
      idProofPublicId: uploadedIdProofPublicId,
      address: buildAddressPayload(req.body),
      createdBy: buildCreatedBy(u),
    });

    return res.status(201).json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    if (uploadedAvatarPublicId) {
      await safeCloudDelete(uploadedAvatarPublicId);
    }
    if (uploadedIdProofPublicId) {
      await safeCloudDelete(uploadedIdProofPublicId);
    }

    const duplicateError = handleMongoDuplicateError(err, res);
    if (duplicateError) return duplicateError;

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function listStaff(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!u?.sub || !u?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    let filter: any = {};

    if (u.role === "MASTER_ADMIN") {
      filter = {};
    } else if (u.role === "MANAGER") {
      filter = {
        "createdBy.id": u.sub,
        "createdBy.role": "MANAGER",
      };
    } else if (u.role === "SUPERVISOR") {
      filter = {
        "createdBy.id": u.sub,
        "createdBy.role": "SUPERVISOR",
      };
    } else if (SELF_ALLOWED_ROLES.includes(u.role as StaffAppRole)) {
      filter = { _id: u.sub };
    } else {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    const items = await StaffModel.find(filter).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: items.map(safe),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function getStaff(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await StaffModel.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    if (!canView(u, doc)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    return res.json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function updateStaff(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await StaffModel.findById(req.params.id).select(STAFF_AUTH_SELECT);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    const {
      name,
      username,
      email,
      pin,
      mobile,
      additionalNumber,
      role,
      isActive,
      removeAvatar,
      removeIdProof,
    } = req.body as any;

    const { dup, exists } = await validateDuplicateStaff(
      {
        email: email !== undefined ? email : doc.email,
        username: username !== undefined ? username : doc.username,
        mobile: mobile !== undefined ? mobile : doc.mobile,
        additionalNumber:
          additionalNumber !== undefined ? additionalNumber : doc.additionalNumber,
      },
      String(doc._id)
    );

    if (exists) {
      return res.status(409).json({
        success: false,
        message: conflictMessage(exists, dup),
      });
    }

    if (normalizeBoolean(removeAvatar)) {
      await safeCloudDelete(doc.avatarPublicId);
      doc.avatarUrl = "";
      doc.avatarPublicId = "";
    }

    if (normalizeBoolean(removeIdProof)) {
      await safeCloudDelete(doc.idProofPublicId);
      doc.idProofUrl = "";
      doc.idProofPublicId = "";
    }

    const { avatarFile, idProofFile } = getUploadFiles(req);

    if (avatarFile) {
      await safeCloudDelete(doc.avatarPublicId);
      const uploaded = await uploadToCloud(avatarFile, CLOUD_FOLDER_STAFF_AVATAR);
      doc.avatarUrl = uploaded.url;
      doc.avatarPublicId = uploaded.publicId;
    }

    if (idProofFile) {
      await safeCloudDelete(doc.idProofPublicId);
      const uploaded = await uploadToCloud(idProofFile, CLOUD_FOLDER_STAFF_IDPROOF);
      doc.idProofUrl = uploaded.url;
      doc.idProofPublicId = uploaded.publicId;
    }

    if (name !== undefined) doc.name = normTrim(name);
    if (username !== undefined) doc.username = normLower(username);
    if (email !== undefined) doc.email = normLower(email);
    if (mobile !== undefined) doc.mobile = normTrim(mobile);
    if (additionalNumber !== undefined) {
      doc.additionalNumber = normTrim(additionalNumber);
    }
    if (role !== undefined) {
      doc.role = getRoleValue(role, getStaffRole(doc));
    }

    applyAddress(doc, req.body);

    if (isActive !== undefined) {
      doc.isActive = normalizeBoolean(isActive);
    }

    if (pin !== undefined && normTrim(pin)) {
      const pinValue = normTrim(pin);

      if (!/^\d{4,8}$/.test(pinValue)) {
        return res.status(400).json({
          success: false,
          message: "PIN must be 4 to 8 digits",
        });
      }

      doc.pinHash = await hashPin(pinValue);
      clearPinResetState(doc);

      await doc.save();
      await revokeStaffSessions(doc);

      return res.json({
        success: true,
        data: safe(doc),
      });
    }

    await doc.save();

    if (isActive !== undefined && doc.isActive === false) {
      await revokeStaffSessions(doc);
    }

    return res.json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    const duplicateError = handleMongoDuplicateError(err, res);
    if (duplicateError) return duplicateError;

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function removeStaffAvatar(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await StaffModel.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    await safeCloudDelete(doc.avatarPublicId);

    doc.avatarUrl = "";
    doc.avatarPublicId = "";

    await doc.save();

    return res.json({
      success: true,
      message: "Avatar removed successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function removeStaffIdProof(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await StaffModel.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    await safeCloudDelete(doc.idProofPublicId);

    doc.idProofUrl = "";
    doc.idProofPublicId = "";

    await doc.save();

    return res.json({
      success: true,
      message: "ID proof removed successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function toggleStaffActive(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await StaffModel.findById(req.params.id).select(STAFF_AUTH_SELECT);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    doc.isActive = !doc.isActive;
    await doc.save();

    if (doc.isActive === false) {
      await revokeStaffSessions(doc);
    }

    return res.json({
      success: true,
      message: `Staff ${doc.isActive ? "activated" : "deactivated"} successfully`,
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function deleteStaff(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await StaffModel.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    await safeCloudDelete(doc.avatarPublicId);
    await safeCloudDelete(doc.idProofPublicId);

    await revokeStaffSessions(doc);
    await doc.deleteOne();

    return res.json({
      success: true,
      message: "Deleted",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ---------------- AUTH ---------------- */

export async function staffLogin(req: Request, res: Response) {
  try {
    const { login, pin, deviceName, platform, appVersion } = req.body as {
      login?: string;
      pin?: string;
      deviceName?: string;
      platform?: string;
      appVersion?: string;
    };

    if (!login || !pin) {
      return res.status(400).json({
        success: false,
        message: "login and pin required",
      });
    }

    const lookup = buildLoginLookup(login);
    const ipAddress = req.ip;

    await assertLoginNotBlocked({
      login: lookup.raw,
      ipAddress,
    });

    const doc = await findStaffByLogin(login, "+pinHash");

    if (!doc) {
      await registerLoginFailure({
        login: lookup.raw,
        ipAddress,
      });

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (doc.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    const ok = await bcrypt.compare(normTrim(pin), doc.pinHash);

    if (!ok) {
      await registerLoginFailure({
        login: lookup.raw,
        ipAddress,
      });

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    await clearLoginFailures({
      login: lookup.raw,
      ipAddress,
    });

    const jwtRole = getStaffRole(doc) as Role;

    const session = await createLoginSession({
      userId: String(doc._id),
      userModel: "Staff",
      role: jwtRole,
      deviceName: normTrim(deviceName),
      platform: normTrim(platform),
      appVersion: normTrim(appVersion),
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || "",
    });

    return res.json({
      success: true,
      message: "Login success",
      data: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        role: jwtRole,
        user: safe(doc),
      },
    });
  } catch (err: any) {
    if (String(err?.message || "").startsWith("Too many failed attempts")) {
      return res.status(429).json({
        success: false,
        message: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ---------------- FORGOT / RESET PIN ---------------- */

export async function forgotStaffPin(req: Request, res: Response) {
  try {
    const { login, email, username, mobile } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      mobile?: string;
    };

    const loginValue = login || email || username || mobile;

    if (!loginValue) {
      return res.status(400).json({
        success: false,
        message: "login/email/username/mobile required",
      });
    }

    const doc = await findStaffByLogin(loginValue, STAFF_AUTH_SELECT);

    if (!doc) {
      return res.json({
        success: true,
        message: "If the account exists, a PIN reset OTP has been sent",
      });
    }

    if (doc.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    const otp = generateOtp(6);

    doc.pinResetOtpHash = await hashText(otp);
    doc.pinResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    doc.pinResetAttempts = 0;
    doc.pinResetTokenHash = "";
    doc.pinResetTokenExpiresAt = null;

    await doc.save();

    await sendStaffPinResetOtpEmail(doc.email, otp, doc.name);

    return res.json({
      success: true,
      message: "If the account exists, a PIN reset OTP has been sent",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function verifyStaffPinOtp(req: Request, res: Response) {
  try {
    const { login, email, username, mobile, otp } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      mobile?: string;
      otp?: string;
    };

    const loginValue = login || email || username || mobile;

    if (!loginValue || !otp) {
      return res.status(400).json({
        success: false,
        message: "login and otp required",
      });
    }

    const doc = await findStaffByLogin(loginValue, STAFF_AUTH_SELECT);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (!doc.pinResetOtpHash || !doc.pinResetOtpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No reset request found",
      });
    }

    if (doc.pinResetOtpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    if ((doc.pinResetAttempts || 0) >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many invalid attempts. Request a new OTP.",
      });
    }

    const isMatch = await bcrypt.compare(normTrim(otp), doc.pinResetOtpHash);

    if (!isMatch) {
      doc.pinResetAttempts = (doc.pinResetAttempts || 0) + 1;
      await doc.save();

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const resetToken = generateResetToken();

    doc.pinResetTokenHash = await hashText(resetToken);
    doc.pinResetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    doc.pinResetOtpHash = "";
    doc.pinResetOtpExpiresAt = null;
    doc.pinResetAttempts = 0;

    await doc.save();

    return res.json({
      success: true,
      message: "OTP verified",
      resetToken,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function resetStaffPin(req: Request, res: Response) {
  try {
    const { login, email, username, mobile, resetToken, newPin } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      mobile?: string;
      resetToken?: string;
      newPin?: string;
    };

    const loginValue = login || email || username || mobile;

    if (!loginValue || !resetToken || !newPin) {
      return res.status(400).json({
        success: false,
        message: "login, resetToken and newPin required",
      });
    }

    const pinValue = normTrim(newPin);
    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    const doc = await findStaffByLogin(loginValue, STAFF_AUTH_SELECT);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (!doc.pinResetTokenHash || !doc.pinResetTokenExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "Reset session not found",
      });
    }

    if (doc.pinResetTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Reset token expired",
      });
    }

    const isValidToken = await bcrypt.compare(
      normTrim(resetToken),
      doc.pinResetTokenHash
    );

    if (!isValidToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token",
      });
    }

    doc.pinHash = await hashPin(pinValue);
    clearPinResetState(doc);

    await doc.save();
    await revokeStaffSessions(doc);

    return res.json({
      success: true,
      message: "PIN reset successful. Please login again.",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function changeStaffPin(req: Request, res: Response) {
  try {
    const result = await getMyStaffDocOrThrow(req, true);

    if (hasStaffDocError(result)) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const { doc } = result;
    const { currentPin, newPin } = req.body as {
      currentPin?: string;
      newPin?: string;
    };

    if (!currentPin || !newPin) {
      return res.status(400).json({
        success: false,
        message: "currentPin and newPin required",
      });
    }

    const isMatch = await bcrypt.compare(normTrim(currentPin), doc.pinHash);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is incorrect",
      });
    }

    const pinValue = normTrim(newPin);
    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    doc.pinHash = await hashPin(pinValue);
    clearPinResetState(doc);

    await doc.save();
    await revokeStaffSessions(doc);

    return res.json({
      success: true,
      message: "PIN changed successfully. Please login again.",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}