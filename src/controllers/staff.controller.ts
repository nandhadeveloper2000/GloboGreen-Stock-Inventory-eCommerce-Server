// src/controllers/staff.controller.ts
import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

import { StaffModel, STAFF_ROLES } from "../models/staff.model";
import cloudinary, { cloudinaryDelete } from "../config/cloudinary";
import { hashPin } from "../utils/pin";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type Role,
} from "../utils/jwt";

type JwtUser = { sub: string; role: "MASTER_ADMIN" | "MANAGER" };
type StaffRole = (typeof STAFF_ROLES)[number];

const CLOUD_FOLDER_STAFF_AVATAR = "Shop Stack/staff/avatar";
const CLOUD_FOLDER_STAFF_IDPROOF = "Shop Stack/staff/idproof";

/* ---------------- utils ---------------- */

function safe(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;
  delete o.pinHash;
  delete o.refreshTokenHash;
  return o;
}

function isObjectId(id: any) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

function normLower(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function normTrim(v: any) {
  return String(v ?? "").trim();
}

function buildCreatedBy(u: JwtUser) {
  if (u.role === "MASTER_ADMIN") {
    return { type: "MASTER", id: u.sub, role: u.role, ref: "Master" };
  }
  return { type: "MANAGER", id: u.sub, role: u.role, ref: "SubAdmin" };
}

function canMutate(u: JwtUser, staffDoc: any) {
  if (!u?.role || !u?.sub) return false;

  // MASTER can manage all
  if (u.role === "MASTER_ADMIN") return true;

  // MANAGER only their created docs
  const createdById =
    staffDoc?.createdBy?.id?.toString?.() ??
    String(staffDoc?.createdBy?.id || "");
  return u.role === "MANAGER" && createdById === u.sub;
}

/* ---------------- cloudinary helpers ---------------- */

async function uploadToCloud(file: Express.Multer.File, folder: string) {
  if (!file?.buffer) {
    throw new Error("File buffer missing. Ensure multer uses memoryStorage().");
  }

  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;

  const r = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
  });

  return { url: r.secure_url, publicId: r.public_id };
}

async function safeCloudDelete(publicId?: string) {
  const pid = String(publicId ?? "").trim();
  if (!pid) return;
  try {
    await cloudinaryDelete(pid); // should call uploader.destroy(pid, {resource_type:"image"})
  } catch {
    // ignore failures
  }
}

/* ---------------- StaffRole normalization ---------------- */

const STAFF_ROLE_SET = new Set<StaffRole>(["STAFF", "SUPERVISOR"]);

function toStaffRole(input: any, fallback: StaffRole = "STAFF"): StaffRole {
  const v = String(input ?? "").trim().toUpperCase();
  return STAFF_ROLE_SET.has(v as StaffRole) ? (v as StaffRole) : fallback;
}

function normalizeStaffRoles(input: any): StaffRole[] {
  const arr = Array.isArray(input) ? input : input ? [input] : ["STAFF"];
  const out = arr.map((x) => toStaffRole(x)).filter(Boolean);
  return out.length ? out : ["STAFF"];
}

/* ---------------- duplicate helpers ---------------- */

function buildDuplicateOr(input: {
  email?: any;
  username?: any;
  mobile?: any;
  additionalNumber?: any;
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

function conflictMessage(exists: any, n: ReturnType<typeof buildDuplicateOr>) {
  const conflicts: string[] = [];
  if (n.nEmail && exists?.email === n.nEmail) conflicts.push("email");
  if (n.nUsername && exists?.username === n.nUsername)
    conflicts.push("username");
  if (n.nMobile && exists?.mobile === n.nMobile) conflicts.push("mobile");
  if (n.nAdditional && exists?.additionalNumber === n.nAdditional)
    conflicts.push("additionalNumber");
  return `Already exists: ${conflicts.join(", ") || "duplicate"}`;
}

/* ---------------- CRUD ---------------- */

/**
 * ✅ CREATE Staff/Supervisor
 */
export async function createStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!u?.sub || !u?.role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!isObjectId(u.sub)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid user id" });
    }

    const {
      name,
      username,
      email,
      pin,
      roles,
      mobile,
      additionalNumber,
      state,
      district,
      taluk,
      area,
      street,
      pincode,
    } = req.body as any;

    if (!name || !username || !email || !pin) {
      return res.status(400).json({
        success: false,
        message: "name, username, email, pin required",
      });
    }

    // ✅ field-wise duplicate check
    const dup = buildDuplicateOr({ email, username, mobile, additionalNumber });
    if (dup.or.length) {
      const exists = await StaffModel.findOne({ $or: dup.or }).select(
        "_id email username mobile additionalNumber"
      );
      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: conflictMessage(exists, dup) });
      }
    }

    const files = req.files as { [k: string]: Express.Multer.File[] } | undefined;
    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    let avatarUrl = "";
    let avatarPublicId = "";
    let idProofUrl = "";
    let idProofPublicId = "";

    if (avatarFile) {
      const up = await uploadToCloud(avatarFile, CLOUD_FOLDER_STAFF_AVATAR);
      avatarUrl = up.url;
      avatarPublicId = up.publicId;
    }

    if (idProofFile) {
      const up = await uploadToCloud(idProofFile, CLOUD_FOLDER_STAFF_IDPROOF);
      idProofUrl = up.url;
      idProofPublicId = up.publicId;
    }

    const roleArr = normalizeStaffRoles(roles);
    const createdBy = buildCreatedBy(u);

    const doc = await StaffModel.create({
      name: normTrim(name),
      username: dup.nUsername || normLower(username),
      email: dup.nEmail || normLower(email),

      pinHash: await hashPin(normTrim(pin)),
      roles: roleArr,

      mobile: dup.nMobile || "",
      additionalNumber: dup.nAdditional || "",

      avatarUrl,
      avatarPublicId,
      idProofUrl,
      idProofPublicId,

      address: {
        state: normTrim(state),
        district: normTrim(district),
        taluk: normTrim(taluk),
        area: normTrim(area),
        street: normTrim(street),
        pincode: normTrim(pincode),
      },

      createdBy,
    });

    return res.status(201).json({ success: true, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/**
 * ✅ LIST (MASTER sees all, MANAGER sees only theirs)
 */
export async function listStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    if (!u?.sub || !u?.role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const filter = u.role === "MASTER_ADMIN" ? {} : { "createdBy.id": u.sub };
    const items = await StaffModel.find(filter).sort({ createdAt: -1 });

    return res.json({ success: true, data: items.map(safe) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/**
 * ✅ GET by ID (MASTER any, MANAGER only theirs)
 */
export async function getStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const doc = await StaffModel.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({ success: true, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/**
 * ✅ UPDATE (MASTER any, MANAGER only theirs)
 */
export async function updateStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const doc = await StaffModel.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const {
      name,
      username,
      email,
      pin,
      roles,
      mobile,
      additionalNumber,
      state,
      district,
      taluk,
      area,
      street,
      pincode,
      isActive,
    } = req.body as any;

    // ✅ field-wise duplicate check (exclude self)
    const incoming = {
      email: email !== undefined ? email : doc.email,
      username: username !== undefined ? username : doc.username,
      mobile: mobile !== undefined ? mobile : doc.mobile,
      additionalNumber:
        additionalNumber !== undefined ? additionalNumber : doc.additionalNumber,
    };

    const dup = buildDuplicateOr(incoming);
    if (dup.or.length) {
      const exists = await StaffModel.findOne({
        _id: { $ne: doc._id },
        $or: dup.or,
      }).select("_id email username mobile additionalNumber");

      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: conflictMessage(exists, dup) });
      }
    }

    const files = req.files as { [k: string]: Express.Multer.File[] } | undefined;
    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    if (avatarFile) {
      await safeCloudDelete(doc.avatarPublicId);
      const up = await uploadToCloud(avatarFile, CLOUD_FOLDER_STAFF_AVATAR);
      doc.avatarUrl = up.url;
      doc.avatarPublicId = up.publicId;
    }

    if (idProofFile) {
      await safeCloudDelete(doc.idProofPublicId);
      const up = await uploadToCloud(idProofFile, CLOUD_FOLDER_STAFF_IDPROOF);
      doc.idProofUrl = up.url;
      doc.idProofPublicId = up.publicId;
    }

    if (name !== undefined) doc.name = normTrim(name);
    if (username !== undefined) doc.username = normLower(username);
    if (email !== undefined) doc.email = normLower(email);
    if (mobile !== undefined) doc.mobile = normTrim(mobile);
    if (additionalNumber !== undefined)
      doc.additionalNumber = normTrim(additionalNumber);

    if (roles !== undefined) doc.roles = normalizeStaffRoles(roles);

    if (pin !== undefined && normTrim(pin)) {
      doc.pinHash = await hashPin(normTrim(pin));
    }

    if (!doc.address) doc.address = {} as any;
    if (state !== undefined) doc.address.state = normTrim(state);
    if (district !== undefined) doc.address.district = normTrim(district);
    if (taluk !== undefined) doc.address.taluk = normTrim(taluk);
    if (area !== undefined) doc.address.area = normTrim(area);
    if (street !== undefined) doc.address.street = normTrim(street);
    if (pincode !== undefined) doc.address.pincode = normTrim(pincode);

    if (isActive !== undefined) {
      doc.isActive = String(isActive) === "true" || isActive === true;
    }

    await doc.save();
    return res.json({ success: true, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/**
 * ✅ DELETE (MASTER any, MANAGER only theirs)
 */
export async function deleteStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const doc = await StaffModel.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (!canMutate(u, doc)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await safeCloudDelete(doc.avatarPublicId);
    await safeCloudDelete(doc.idProofPublicId);

    await doc.deleteOne();
    return res.json({ success: true, message: "Deleted" });
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
    const { login, pin } = req.body as { login?: string; pin?: string };

    if (!login || !pin) {
      return res
        .status(400)
        .json({ success: false, message: "login and pin required" });
    }

    const nLogin = String(login).trim().toLowerCase();

    const doc = await StaffModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: normTrim(login) }],
    });

    if (!doc)
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    if (doc.isActive === false)
      return res.status(403).json({ success: false, message: "Account disabled" });

    const ok = await bcrypt.compare(normTrim(pin), doc.pinHash);
    if (!ok)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    const staffRole = toStaffRole(doc.roles?.[0], "STAFF");
    const jwtRole: Role = staffRole; // Role union includes STAFF/SUPERVISOR

    const accessToken = signAccessToken(String(doc._id), jwtRole);
    const refreshToken = signRefreshToken(String(doc._id), jwtRole);

    doc.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await doc.save();

    return res.json({
      success: true,
      message: "Login success",
      accessToken,
      refreshToken,
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

export async function staffLogout(req: Request, res: Response) {
  try {
    const u = (req as any).user as { sub?: string; role?: string };
    if (!u?.sub) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await StaffModel.updateOne({ _id: u.sub }, { $unset: { refreshTokenHash: 1 } });
    return res.json({ success: true, message: "Logged out" });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}