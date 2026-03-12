import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { SubAdminModel } from "../models/subadmin.model";
import cloudinary, { cloudinaryDelete } from "../config/cloudinary";
import { hashPin } from "../utils/pin";
import { sendPinResetOtpEmail } from "../utils/pinResetEmails";
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

  delete o.pinResetOtpHash;
  delete o.pinResetOtpExpiresAt;
  delete o.pinResetAttempts;
  delete o.pinResetTokenHash;
  delete o.pinResetTokenExpiresAt;

  return o;
}

async function hashToken(token: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(token, salt);
}

async function hashText(value: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(value, salt);
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
  const v = String(input ?? "")
    .trim()
    .toUpperCase();
  return ROLE_SET.has(v as Role) ? (v as Role) : fallback;
}

function normalizeRoles(input: any): Role[] {
  const arr = Array.isArray(input)
    ? input
    : input
      ? [input]
      : [DEFAULT_SUBADMIN_ROLE];

  const out = arr.map((x) => toRole(x)).filter(Boolean);
  return out.length ? out : [DEFAULT_SUBADMIN_ROLE];
}

/* ----------------------------- CRUD ----------------------------- */

// CREATE
export async function createSubAdmin(req: Request, res: Response) {
  try {
    const { name, username, email, pin, roles, mobile, additionalNumber } =
      req.body as any;

    if (!name || !username || !email || !pin) {
      return res.status(400).json({
        success: false,
        message: "name, username, email, pin required",
      });
    }

    const nName = String(name).trim();
    const nUsername = String(username).trim().toLowerCase();
    const nEmail = String(email).trim().toLowerCase();
    const nMobile = mobile ? String(mobile).trim() : "";
    const nAdditional = additionalNumber ? String(additionalNumber).trim() : "";

    const or: any[] = [{ email: nEmail }, { username: nUsername }];
    if (nMobile) or.push({ mobile: nMobile });
    if (nAdditional) or.push({ additionalNumber: nAdditional });

    const hits = await SubAdminModel.find({ $or: or })
      .select("email username mobile additionalNumber")
      .lean();

    if (hits.length) {
      const errors: Record<string, string> = {};

      if (hits.some((d: any) => (d.email || "").toLowerCase() === nEmail)) {
        errors.email = "Email already exists";
      }
      if (hits.some((d: any) => (d.username || "").toLowerCase() === nUsername)) {
        errors.username = "Username already exists";
      }
      if (nMobile && hits.some((d: any) => String(d.mobile || "") === nMobile)) {
        errors.mobile = "Mobile already exists";
      }
      if (
        nAdditional &&
        hits.some((d: any) => String(d.additionalNumber || "") === nAdditional)
      ) {
        errors.additionalNumber = "Additional number already exists";
      }

      return conflict(res, errors);
    }

    let avatarUrl = "";
    let avatarPublicId = "";
    let idProofUrl = "";
    let idProofPublicId = "";

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

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

    return res.status(201).json({
      success: true,
      data: safeSubAdmin(doc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
        errors: { [key]: `${key} already exists` },
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// LIST
export async function listSubAdmins(req: Request, res: Response) {
  try {
    const items = await SubAdminModel.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: items.map(safeSubAdmin) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// GET ONE
export async function getSubAdmin(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, data: safeSubAdmin(doc) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// UPDATE
export async function updateSubAdmin(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const {
      name,
      username,
      email,
      pin,
      roles,
      mobile,
      additionalNumber,
      isActive,
    } = req.body as any;

    const nUsername =
      username !== undefined ? String(username).trim().toLowerCase() : undefined;
    const nEmail =
      email !== undefined ? String(email).trim().toLowerCase() : undefined;
    const nMobile = mobile !== undefined ? String(mobile).trim() : undefined;
    const nAdditional =
      additionalNumber !== undefined
        ? String(additionalNumber).trim()
        : undefined;

    const or: any[] = [];
    if (nEmail) or.push({ email: nEmail });
    if (nUsername) or.push({ username: nUsername });
    if (nMobile) or.push({ mobile: nMobile });
    if (nAdditional) or.push({ additionalNumber: nAdditional });

    if (or.length) {
      const hits = await SubAdminModel.find({
        _id: { $ne: doc._id },
        $or: or,
      })
        .select("email username mobile additionalNumber")
        .lean();

      if (hits.length) {
        const errors: Record<string, string> = {};

        if (nEmail && hits.some((d: any) => (d.email || "").toLowerCase() === nEmail)) {
          errors.email = "Email already exists";
        }
        if (
          nUsername &&
          hits.some((d: any) => (d.username || "").toLowerCase() === nUsername)
        ) {
          errors.username = "Username already exists";
        }
        if (nMobile && hits.some((d: any) => String(d.mobile || "") === nMobile)) {
          errors.mobile = "Mobile already exists";
        }
        if (
          nAdditional &&
          hits.some((d: any) => String(d.additionalNumber || "") === nAdditional)
        ) {
          errors.additionalNumber = "Additional number already exists";
        }

        return conflict(res, errors);
      }
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

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

    if (name !== undefined) doc.name = String(name).trim();
    if (nUsername !== undefined) doc.username = nUsername;
    if (nEmail !== undefined) doc.email = nEmail;
    if (nMobile !== undefined) doc.mobile = nMobile;
    if (nAdditional !== undefined) doc.additionalNumber = nAdditional;
    if (roles !== undefined) doc.roles = normalizeRoles(roles);

    if (isActive !== undefined) {
      if (typeof isActive === "boolean") {
        doc.isActive = isActive;
      } else {
        doc.isActive = String(isActive).trim().toLowerCase() === "true";
      }
    }

    if (pin !== undefined && String(pin).trim()) {
      doc.pinHash = await hashPin(String(pin).trim());
    }

    await doc.save();

    return res.json({
      success: true,
      data: safeSubAdmin(doc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
        errors: { [key]: `${key} already exists` },
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}
// DELETE
export async function deleteSubAdmin(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (doc.avatarPublicId) await cloudinaryDelete(doc.avatarPublicId);
    if (doc.idProofPublicId) await cloudinaryDelete(doc.idProofPublicId);

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

/* ----------------------------- AUTH ----------------------------- */

// LOGIN
export async function subAdminLogin(req: Request, res: Response) {
  try {
    const { login, username, pin } = req.body as {
      login?: string;
      username?: string;
      pin?: string;
    };

    const loginValue = login || username;

    if (!loginValue || !pin) {
      return res.status(400).json({
        success: false,
        message: "login and pin required",
      });
    }

    const nLogin = String(loginValue).trim().toLowerCase();

    const doc = await SubAdminModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: nLogin }],
    });

    if (!doc) {
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

    const isMatch = await bcrypt.compare(String(pin).trim(), doc.pinHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

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
      role,
      roles: doc.roles || [role],
      data: safeSubAdmin(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// LOGOUT
export async function subAdminLogout(req: Request, res: Response) {
  try {
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await SubAdminModel.updateOne(
      { _id: subAdminId },
      { $unset: { refreshTokenHash: 1 } }
    );

    return res.json({ success: true, message: "Logged out successfully" });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// REFRESH TOKEN
export async function subAdminRefreshToken(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "refreshToken required",
      });
    }

    const decoded = verifyRefreshToken(refreshToken) as any;
    if (!decoded?.sub) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const doc = await SubAdminModel.findById(decoded.sub);
    if (!doc || !doc.refreshTokenHash) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const tokenMatch = await bcrypt.compare(refreshToken, doc.refreshTokenHash);
    if (!tokenMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    if (doc.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    const role = toRole(doc.roles?.[0], "MANAGER");
    const newAccessToken = signAccessToken(String(doc._id), role);
    const newRefreshToken = signRefreshToken(String(doc._id), role);

    doc.refreshTokenHash = await hashToken(newRefreshToken);
    await doc.save();

    return res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      role,
      roles: doc.roles || [role],
      data: safeSubAdmin(doc),
    });
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
      error: err?.message,
    });
  }
}

/* ----------------------------- FORGOT / RESET PIN ----------------------------- */

// FORGOT PIN - SEND OTP
export async function forgotSubAdminPin(req: Request, res: Response) {
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

    const nLogin = String(loginValue).trim().toLowerCase();

    const doc = await SubAdminModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: nLogin }],
    });

    // do not expose whether account exists
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

    await sendPinResetOtpEmail({
      to: doc.email,
      otp,
      name: doc.name,
      variant: "subadmin",
    });
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

// VERIFY OTP
export async function verifySubAdminPinOtp(req: Request, res: Response) {
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

    const nLogin = String(loginValue).trim().toLowerCase();

    const doc = await SubAdminModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: nLogin }],
    });

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

    const isMatch = await bcrypt.compare(
      String(otp).trim(),
      doc.pinResetOtpHash
    );

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

// RESET PIN
export async function resetSubAdminPin(req: Request, res: Response) {
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

    const pinValue = String(newPin).trim();

    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    const nLogin = String(loginValue).trim().toLowerCase();

    const doc = await SubAdminModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: nLogin }],
    });

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
      String(resetToken).trim(),
      doc.pinResetTokenHash
    );

    if (!isValidToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token",
      });
    }

    doc.pinHash = await hashPin(pinValue);

    doc.pinResetOtpHash = "";
    doc.pinResetOtpExpiresAt = null;
    doc.pinResetAttempts = 0;
    doc.pinResetTokenHash = "";
    doc.pinResetTokenExpiresAt = null;

    doc.refreshTokenHash = "";

    await doc.save();

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

// CHANGE PIN (LOGGED IN)
export async function changeSubAdminPin(req: Request, res: Response) {
  try {
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

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

    const pinValue = String(newPin).trim();

    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    const doc = await SubAdminModel.findById(subAdminId);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const isMatch = await bcrypt.compare(String(currentPin).trim(), doc.pinHash);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is incorrect",
      });
    }

    doc.pinHash = await hashPin(pinValue);
    doc.refreshTokenHash = "";

    await doc.save();

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

/* ----------------------------- PROFILE ----------------------------- */

// AVATAR UPLOAD (SELF)
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

    if (doc.avatarPublicId) {
      await cloudinaryDelete(doc.avatarPublicId);
    }

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
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// AVATAR REMOVE (SELF)
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

    return res.json({
      success: true,
      message: "Avatar removed",
      data: safeSubAdmin(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// SELF GET /me
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
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// MASTER GET /:id
export async function getSubAdminById(req: Request, res: Response) {
  try {
    const doc = await SubAdminModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, data: safeSubAdmin(doc) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// MASTER PUT /:id/avatar
export async function masterSubAdminAvatarUpload(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, message: "avatar file required" });
    }

    const doc = await SubAdminModel.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (doc.avatarPublicId) {
      await cloudinaryDelete(doc.avatarPublicId);
    }

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
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

// SELF UPDATE
export async function updateSubAdminMe(req: Request, res: Response) {
  try {
    const user = (req as any).user || {};
    const subAdminId = user.sub || user.subAdminId || user.id;

    if (!subAdminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

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