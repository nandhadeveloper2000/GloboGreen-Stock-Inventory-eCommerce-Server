// src/controllers/subadmin.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { SubAdminModel } from "../models/subadmin.model";
import cloudinary, { cloudinaryDelete } from "../config/cloudinary";
import { hashPin } from "../utils/pin";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type Role,
} from "../utils/jwt";

/* ----------------------------- helpers ----------------------------- */

function safeSubAdmin(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;
  delete o.pinHash;
  delete o.refreshTokenHash;
  return o;
}

async function hashToken(token: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(token, salt);
}

async function uploadToCloud(file: Express.Multer.File, folder: string) {
  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;
  const res = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
  });
  return { url: res.secure_url, publicId: res.public_id };
}
const CLOUD_FOLDER_SUBADMIN_AVATAR = "Shop Stack/subadmins/avatar";
const CLOUD_FOLDER_SUBADMIN_IDPROOF = "Shop Stack/subadmins/idproof";

function conflict(res: Response, errors: Record<string, string>) {
  return res.status(409).json({
    success: false,
    message: "Already exists. Fix the highlighted fields.",
    errors,
  });
}

/** ✅ Role normalizer (fixes TS: string -> Role) */
const ROLE_SET = new Set<Role>([
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
  "CUSTOMER",
]);

const DEFAULT_SUBADMIN_ROLE: Role = "MANAGER";

function toRole(input: any, fallback: Role = DEFAULT_SUBADMIN_ROLE): Role {
  const v = String(input ?? "").trim().toUpperCase();
  return ROLE_SET.has(v as Role) ? (v as Role) : fallback;
}

function normalizeRoles(input: any): Role[] {
  const arr = Array.isArray(input) ? input : input ? [input] : [DEFAULT_SUBADMIN_ROLE];
  const out = arr.map((x) => toRole(x)).filter(Boolean);
  return out.length ? out : [DEFAULT_SUBADMIN_ROLE];
}

/* ----------------------------- CRUD ----------------------------- */

// ✅ CREATE
export async function createSubAdmin(req: Request, res: Response) {
  try {
    const { name, username, email, pin, roles, mobile, additionalNumber } = req.body as any;

    if (!name || !username || !email || !pin) {
      return res.status(400).json({
        success: false,
        message: "name, username, email, pin required",
      });
    }

    // ✅ normalize
    const nName = String(name).trim();
    const nUsername = String(username).trim().toLowerCase();
    const nEmail = String(email).trim().toLowerCase();
    const nMobile = mobile ? String(mobile).trim() : "";
    const nAdditional = additionalNumber ? String(additionalNumber).trim() : "";

    // ✅ field-wise duplicate check
    const or: any[] = [{ email: nEmail }, { username: nUsername }];
    if (nMobile) or.push({ mobile: nMobile });
    if (nAdditional) or.push({ additionalNumber: nAdditional });

    const hits = await SubAdminModel.find({ $or: or })
      .select("email username mobile additionalNumber")
      .lean();

    if (hits.length) {
      const errors: Record<string, string> = {};

      if (hits.some((d: any) => (d.email || "").toLowerCase() === nEmail))
        errors.email = "Email already exists";
      if (hits.some((d: any) => (d.username || "").toLowerCase() === nUsername))
        errors.username = "Username already exists";
      if (nMobile && hits.some((d: any) => String(d.mobile || "") === nMobile))
        errors.mobile = "Mobile already exists";
      if (nAdditional && hits.some((d: any) => String(d.additionalNumber || "") === nAdditional))
        errors.additionalNumber = "Additional number already exists";

      return conflict(res, errors);
    }

    // ✅ upload only after validation passes
    let avatarUrl = "";
    let avatarPublicId = "";
    let idProofUrl = "";
    let idProofPublicId = "";

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    if (avatarFile) {
      const up = await uploadToCloud(avatarFile, CLOUD_FOLDER_SUBADMIN_AVATAR);
      avatarUrl = up.url;
      avatarPublicId = up.publicId;
    }

    if (idProofFile) {
      const up = await uploadToCloud(idProofFile, CLOUD_FOLDER_SUBADMIN_IDPROOF);
      idProofUrl = up.url;
      idProofPublicId = up.publicId;
    }

    const doc = await SubAdminModel.create({
      name: nName,
      username: nUsername,
      email: nEmail,
      pinHash: await hashPin(String(pin).trim()),
      roles: normalizeRoles(roles),
      mobile: nMobile,
      additionalNumber: nAdditional,
      avatarUrl,
      avatarPublicId,
      idProofUrl,
      idProofPublicId,
    });

    return res.status(201).json({ success: true, data: safeSubAdmin(doc) });
  } catch (err: any) {
    // ✅ DB race-condition safe duplicate handling
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
        errors: { [key]: `${key} already exists` },
      });
    }
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ✅ LIST
export async function listSubAdmins(req: Request, res: Response) {
  try {
    const items = await SubAdminModel.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: items.map(safeSubAdmin) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ✅ GET ONE
export async function getSubAdmin(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: safeSubAdmin(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ✅ UPDATE
export async function updateSubAdmin(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const { name, username, email, pin, roles, mobile, additionalNumber, isActive } = req.body as any;

    // ✅ normalize incoming (only if provided)
    const nUsername = username !== undefined ? String(username).trim().toLowerCase() : undefined;
    const nEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
    const nMobile = mobile !== undefined ? String(mobile).trim() : undefined;
    const nAdditional = additionalNumber !== undefined ? String(additionalNumber).trim() : undefined;

    // ✅ duplicate check before update (excluding current doc)
    const or: any[] = [];
    if (nEmail) or.push({ email: nEmail });
    if (nUsername) or.push({ username: nUsername });
    if (nMobile) or.push({ mobile: nMobile });
    if (nAdditional) or.push({ additionalNumber: nAdditional });

    if (or.length) {
      const hits = await SubAdminModel.find({ _id: { $ne: doc._id }, $or: or })
        .select("email username mobile additionalNumber")
        .lean();

      if (hits.length) {
        const errors: Record<string, string> = {};
        if (nEmail && hits.some((d: any) => (d.email || "").toLowerCase() === nEmail))
          errors.email = "Email already exists";
        if (nUsername && hits.some((d: any) => (d.username || "").toLowerCase() === nUsername))
          errors.username = "Username already exists";
        if (nMobile && hits.some((d: any) => String(d.mobile || "") === nMobile))
          errors.mobile = "Mobile already exists";
        if (nAdditional && hits.some((d: any) => String(d.additionalNumber || "") === nAdditional))
          errors.additionalNumber = "Additional number already exists";
        return conflict(res, errors);
      }
    }

    // ✅ files
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    if (avatarFile) {
      if (doc.avatarPublicId) await cloudinaryDelete(doc.avatarPublicId);
      const up = await uploadToCloud(avatarFile, CLOUD_FOLDER_SUBADMIN_AVATAR);
      doc.avatarUrl = up.url;
      doc.avatarPublicId = up.publicId;
    }

    if (idProofFile) {
      if (doc.idProofPublicId) await cloudinaryDelete(doc.idProofPublicId);
      const up = await uploadToCloud(idProofFile, CLOUD_FOLDER_SUBADMIN_IDPROOF);
      doc.idProofUrl = up.url;
      doc.idProofPublicId = up.publicId;
    }

    // ✅ fields
    if (name !== undefined) doc.name = String(name).trim();
    if (nUsername !== undefined) doc.username = nUsername;
    if (nEmail !== undefined) doc.email = nEmail;
    if (nMobile !== undefined) doc.mobile = nMobile;
    if (nAdditional !== undefined) doc.additionalNumber = nAdditional;

    if (roles !== undefined) doc.roles = normalizeRoles(roles);

    if (isActive !== undefined) doc.isActive = String(isActive) === "true" || isActive === true;

    if (pin !== undefined && String(pin).trim()) {
      doc.pinHash = await hashPin(String(pin).trim());
    }

    await doc.save();
    return res.json({ success: true, data: safeSubAdmin(doc) });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
        errors: { [key]: `${key} already exists` },
      });
    }
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ✅ DELETE
export async function deleteSubAdmin(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (doc.avatarPublicId) await cloudinaryDelete(doc.avatarPublicId);
    if (doc.idProofPublicId) await cloudinaryDelete(doc.idProofPublicId);

    await doc.deleteOne();
    return res.json({ success: true, message: "Deleted" });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/* ----------------------------- AUTH ----------------------------- */

// ✅ LOGIN
export async function subAdminLogin(req: Request, res: Response) {
  try {
    const { login, pin } = req.body as { login?: string; pin?: string };

    if (!login || !pin) {
      return res.status(400).json({ success: false, message: "login and pin required" });
    }

    const nLogin = String(login).trim().toLowerCase();

    const doc = await SubAdminModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: nLogin }],
    });

    if (!doc) return res.status(401).json({ success: false, message: "Invalid credentials" });

    if (doc.isActive === false) {
      return res.status(403).json({ success: false, message: "Account disabled" });
    }

    const isMatch = await bcrypt.compare(String(pin).trim(), doc.pinHash);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const role = toRole(doc.roles?.[0], "MANAGER");

    const accessToken = signAccessToken(String(doc._id), role);
    const refreshToken = signRefreshToken(String(doc._id), role);

    doc.refreshTokenHash = await hashToken(refreshToken);
    await doc.save();

    return res.json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      data: safeSubAdmin(doc),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}


// ✅ LOGOUT
export async function subAdminLogout(req: Request, res: Response) {
  try {
    /**
     * Your auth.middleware should set something like:
     * req.user = { sub: "...", role: "MANAGER", ... }
     */
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await SubAdminModel.updateOne({ _id: subAdminId }, { $unset: { refreshTokenHash: 1 } });

    return res.json({ success: true, message: "Logged out successfully" });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ✅ Avatar Upload (Self)
export async function subAdminAvatarUpload(req: Request, res: Response) {
  try {
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, message: "avatar file required" });
    }

    const doc = await SubAdminModel.findById(subAdminId);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    // remove old
    if (doc.avatarPublicId) {
      await cloudinaryDelete(doc.avatarPublicId);
    }

    // upload new
    const up = await uploadToCloud(file, CLOUD_FOLDER_SUBADMIN_AVATAR);
    doc.avatarUrl = up.url;
    doc.avatarPublicId = up.publicId;

    await doc.save();

    return res.json({
      success: true,
      message: "Avatar updated",
      data: safeSubAdmin(doc),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ✅ Avatar Remove (Self)
export async function subAdminAvatarRemove(req: Request, res: Response) {
  try {
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const doc = await SubAdminModel.findById(subAdminId);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (doc.avatarPublicId) {
      await cloudinaryDelete(doc.avatarPublicId);
    }

    doc.avatarUrl = "";
    doc.avatarPublicId = "";
    await doc.save();

    return res.json({ success: true, message: "Avatar removed", data: safeSubAdmin(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}
// ✅ SUBADMIN SELF: GET /me
export async function getSubAdminMe(req: Request, res: Response) {
  try {
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const doc = await SubAdminModel.findById(subAdminId);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, data: safeSubAdmin(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ✅ MASTER: GET /:id
export async function getSubAdminById(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: safeSubAdmin(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}
// ✅ MASTER: PUT /:id/avatar (FormData avatar)
export async function masterSubAdminAvatarUpload(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, message: "avatar file required" });
    }

    const doc = await SubAdminModel.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    // remove old
    if (doc.avatarPublicId) {
      await cloudinaryDelete(doc.avatarPublicId);
    }

    // upload new
    const up = await uploadToCloud(file, CLOUD_FOLDER_SUBADMIN_AVATAR);
    doc.avatarUrl = up.url;
    doc.avatarPublicId = up.publicId;

    await doc.save();

    return res.json({
      success: true,
      message: "Avatar updated",
      data: safeSubAdmin(doc), // ✅ your frontend reads json.data.avatarUrl
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}
// Reuse existing updateSubAdmin() by setting req.params.id = logged in user id
export async function updateSubAdminMe(req: Request, res: Response) {
  try {
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // ✅ reuse your existing updateSubAdmin code
    (req as any).params = { ...(req as any).params, id: String(subAdminId) };

    return updateSubAdmin(req, res);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}