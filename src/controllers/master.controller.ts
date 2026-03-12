import type { Response } from "express";
import { isValidObjectId } from "mongoose";
import { MasterModel } from "../models/master.model";
import { comparePin, hashPin } from "../utils/pin";
import cloudinary from "../config/cloudinary";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type Role,
} from "../utils/jwt";
import type { AuthRequest } from "../types/auth";
import { verifyGoogleIdToken } from "../utils/google";
import { generateOtp } from "../utils/otp";
import { sendEmail } from "../utils/sendEmail";
import { buildOtpEmailTemplate } from "../utils/emailTemplates";

function safeMaster(doc: any) {
  const o = doc.toObject ? doc.toObject() : doc;
  delete o.pinHash;
  delete o.refreshTokenHash;
  delete o.pinResetOtp;
  delete o.pinResetOtpExpiresAt;
  return o;
}

function getSeeds() {
  return [
    { login: process.env.MASTER_LOGIN_1, pin: process.env.MASTER_PIN_1 },
    { login: process.env.MASTER_LOGIN_2, pin: process.env.MASTER_PIN_2 },
  ].filter((s) => s.login && s.pin);
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

function toRole(input: any, fallback: Role = "MASTER_ADMIN"): Role {
  const v = String(input ?? "").trim().toUpperCase();
  return ROLE_SET.has(v as Role) ? (v as Role) : fallback;
}

function getAllowedMasterEmails(): Set<string> {
  const raw = String(process.env.MASTER_GOOGLE_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return new Set(raw);
}

function maskEmail(email?: string) {
  if (!email) return "";
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0] || ""}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

/* ===================== AUTH ===================== */

// ✅ LOGIN (public)
export async function masterLogin(req: AuthRequest, res: Response) {
  const { login, pin } = req.body as any;

  if (!login || !pin) {
    return res
      .status(400)
      .json({ success: false, message: "login and pin required" });
  }

  const loginStr = String(login).trim();
  const loginLower = loginStr.toLowerCase();
  const pinStr = String(pin).trim();

  let master = await MasterModel.findOne({
    $or: [{ email: loginLower }, { username: loginLower }],
  });

  if (!master) {
    const seeds = getSeeds();

    const matchedSeed = seeds.find(
      (s) =>
        String(s.login).trim() === loginStr &&
        String(s.pin).trim() === pinStr
    );

    if (!matchedSeed) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const username = `master_${loginStr}`.toLowerCase();
    const email = `master_${loginStr}@seed.local`.toLowerCase();

    master = await MasterModel.findOne({ username });

    if (!master) {
      master = await MasterModel.create({
        name: "Master Admin",
        username,
        email,
        pinHash: await hashPin(pinStr),
        role: "MASTER_ADMIN",
        isActive: true,
      });
    }
  }

  if (!master.isActive) {
    return res
      .status(403)
      .json({ success: false, message: "Account disabled" });
  }

  const isValid = await comparePin(pinStr, master.pinHash);
  if (!isValid) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  const role = toRole(master.role, "MASTER_ADMIN");
  const accessToken = signAccessToken(master._id.toString(), role);
  const refreshToken = signRefreshToken(master._id.toString(), role);

  master.refreshTokenHash = await hashPin(refreshToken);
  await master.save();

  return res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      user: safeMaster(master),
    },
  });
}

// ✅ REFRESH (public)
export async function masterRefresh(req: AuthRequest, res: Response) {
  const { refreshToken } = req.body as any;

  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, message: "refreshToken required" });
  }

  let payload: any;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "Invalid refresh token" });
  }

  const master = await MasterModel.findById(payload.sub);
  if (!master || !master.isActive) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const ok = await comparePin(refreshToken, master.refreshTokenHash || "");
  if (!ok) {
    return res.status(401).json({ success: false, message: "Token mismatch" });
  }

  const role = toRole(master.role, payload.role || "MASTER_ADMIN");
  const newAccessToken = signAccessToken(master._id.toString(), role);

  return res.json({
    success: true,
    data: { accessToken: newAccessToken },
  });
}

// ✅ LOGOUT (public)
export async function masterLogout(req: AuthRequest, res: Response) {
  const { refreshToken } = req.body as any;

  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, message: "refreshToken required" });
  }

  let payload: any;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "Invalid refresh token" });
  }

  const master = await MasterModel.findById(payload.sub);
  if (master) {
    master.refreshTokenHash = "";
    await master.save();
  }

  return res.json({ success: true, message: "Logged out" });
}

/* ===================== PIN MANAGEMENT ===================== */

// ✅ FORGOT PIN (public)
export async function masterForgotPin(req: AuthRequest, res: Response) {
  try {
    const { login, email, username } = req.body as {
      login?: string;
      email?: string;
      username?: string;
    };

    const loginValue = login || email || username;

    if (!loginValue) {
      return res.status(400).json({
        success: false,
        message: "login/email/username required",
      });
    }

    const nLogin = String(loginValue).trim().toLowerCase();

    const master = await MasterModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }],
    });

    if (!master) {
      return res.json({
        success: true,
        message: "If the account exists, a PIN reset OTP has been sent",
      });
    }

    if (!master.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    if (!master.email) {
      return res.status(400).json({
        success: false,
        message: "No email found for this account",
      });
    }

    const otp = generateOtp(6);

    const emailTemplate = buildOtpEmailTemplate({
      appName: "ShopStack",
      otp,
      expiryMinutes: 10,
      username: master.name || "User",
      supportEmail: "support@shopstack.app",
    });

    try {
      await sendEmail({
        to: master.email,
        subject: emailTemplate.subject,
        text: emailTemplate.text,
        html: emailTemplate.html,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: err?.message || "Failed to send OTP email",
      });
    }

    (master as any).pinResetOtp = otp;
    (master as any).pinResetOtpExpiresAt = new Date(
      Date.now() + 10 * 60 * 1000
    );
    await master.save();

    return res.json({
      success: true,
      message: `OTP sent to ${maskEmail(master.email)}`,
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Forgot PIN failed",
    });
  }
}

// ✅ RESET PIN WITH OTP (public)
export async function masterResetPin(req: AuthRequest, res: Response) {
  try {
    const { login, email, username, otp, newPin } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      otp?: string;
      newPin?: string;
    };

    const loginValue = login || email || username;

    if (!loginValue || !otp || !newPin) {
      return res.status(400).json({
        success: false,
        message: "login/email/username, otp and newPin required",
      });
    }

    const nLogin = String(loginValue).trim().toLowerCase();
    const otpStr = String(otp).trim();
    const pinStr = String(newPin).trim();

    if (pinStr.length < 4) {
      return res.status(400).json({
        success: false,
        message: "newPin must be at least 4 digits",
      });
    }

    const master = await MasterModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }],
    });

    if (!master) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (!master.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    const savedOtp = String((master as any).pinResetOtp || "").trim();
    const expiresAt = (master as any).pinResetOtpExpiresAt
      ? new Date((master as any).pinResetOtpExpiresAt)
      : null;

    if (!savedOtp || !expiresAt) {
      return res.status(400).json({
        success: false,
        message: "No reset request found",
      });
    }

    if (savedOtp !== otpStr) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (expiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    master.pinHash = await hashPin(pinStr);
    master.refreshTokenHash = "";
    (master as any).pinResetOtp = "";
    (master as any).pinResetOtpExpiresAt = null;

    await master.save();

    return res.json({
      success: true,
      message: "PIN reset successful. Please login again.",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Reset PIN failed",
    });
  }
}

// ✅ CHANGE PIN (protected)
export async function masterChangePin(req: AuthRequest, res: Response) {
  try {
    const id = req.user?.id;
    if (!id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
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

    const currentPinStr = String(currentPin).trim();
    const newPinStr = String(newPin).trim();

    if (newPinStr.length < 4) {
      return res.status(400).json({
        success: false,
        message: "newPin must be at least 4 digits",
      });
    }

    const master = await MasterModel.findById(id);
    if (!master || !master.isActive) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const ok = await comparePin(currentPinStr, master.pinHash);
    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is incorrect",
      });
    }

    const samePin = await comparePin(newPinStr, master.pinHash);
    if (samePin) {
      return res.status(400).json({
        success: false,
        message: "New PIN must be different from current PIN",
      });
    }

    master.pinHash = await hashPin(newPinStr);
    master.refreshTokenHash = "";
    (master as any).pinResetOtp = "";
    (master as any).pinResetOtpExpiresAt = null;

    await master.save();

    return res.json({
      success: true,
      message: "PIN changed successfully. Please login again.",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Change PIN failed",
    });
  }
}

/* ===================== PROTECTED ===================== */

// ✅ ME
export async function masterMe(req: AuthRequest, res: Response) {
  const id = req.user?.id;

  if (!id) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const master = await MasterModel.findById(id);
  if (!master || !master.isActive) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  return res.json({
    success: true,
    data: { user: safeMaster(master) },
  });
}

/* ===================== ADMIN CRUD (MASTER_ADMIN) ===================== */

export async function masterList(req: AuthRequest, res: Response) {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const q = String(req.query.q || "").trim();

  const filter: any = {};
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: "i" } },
      { username: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
      { role: { $regex: q, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    MasterModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    MasterModel.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: {
      items: items.map(safeMaster),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}

export async function masterGetById(req: AuthRequest, res: Response) {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: "Invalid id" });
  }

  const master = await MasterModel.findById(id);
  if (!master) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  return res.json({
    success: true,
    data: { user: safeMaster(master) },
  });
}

export async function masterUpdate(req: AuthRequest, res: Response) {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: "Invalid id" });
  }

  const master = await MasterModel.findById(id);
  if (!master) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  const {
    name,
    username,
    email,
    role,
    isActive,
    avatarUrl,
    avatarPublicId,
    pin,
  } = req.body as any;

  if (typeof name === "string") master.name = name.trim();

  if (typeof username === "string" && username.trim()) {
    const uname = username.trim().toLowerCase();
    const exists = await MasterModel.findOne({
      username: uname,
      _id: { $ne: master._id },
    });

    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: "username already exists" });
    }

    master.username = uname;
  }

  if (typeof email === "string" && email.trim()) {
    const em = email.trim().toLowerCase();
    const exists = await MasterModel.findOne({
      email: em,
      _id: { $ne: master._id },
    });

    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: "email already exists" });
    }

    master.email = em;
  }

  if (typeof avatarUrl === "string") master.avatarUrl = avatarUrl.trim();
  if (typeof avatarPublicId === "string") {
    master.avatarPublicId = avatarPublicId.trim();
  }

  if (typeof isActive === "boolean") {
    if (req.user?.id === master._id.toString() && isActive === false) {
      return res.status(400).json({
        success: false,
        message: "You cannot disable your own account",
      });
    }

    master.isActive = isActive;
  }

  if (role !== undefined) {
    master.role = toRole(role, "MASTER_ADMIN");
  }

  if (pin !== undefined) {
    const pinStr = String(pin ?? "").trim();

    if (pinStr.length < 4) {
      return res.status(400).json({
        success: false,
        message: "pin must be at least 4 digits",
      });
    }

    master.pinHash = await hashPin(pinStr);
    master.refreshTokenHash = "";
    (master as any).pinResetOtp = "";
    (master as any).pinResetOtpExpiresAt = null;
  }

  await master.save();

  return res.json({
    success: true,
    data: { user: safeMaster(master) },
  });
}

export async function masterDelete(req: AuthRequest, res: Response) {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: "Invalid id" });
  }

  if (req.user?.id === id) {
    return res.status(400).json({
      success: false,
      message: "You cannot delete your own account",
    });
  }

  const master = await MasterModel.findById(id);
  if (!master) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  await MasterModel.deleteOne({ _id: id });
  return res.json({ success: true, message: "Deleted" });
}

export async function masterAvatarUpload(req: AuthRequest, res: Response) {
  try {
    const id = req.user?.id;

    if (!id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const file = (req as any).file as
      | { buffer: Buffer; mimetype?: string }
      | undefined;

    if (!file?.buffer) {
      return res
        .status(400)
        .json({ success: false, message: "avatar file required" });
    }

    const master = await MasterModel.findById(id);
    if (!master) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (master.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(master.avatarPublicId);
      } catch {}
    }

    const uploaded: any = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "Shop Stack/masters",
          resource_type: "image",
          transformation: [
            { width: 512, height: 512, crop: "fill", gravity: "face" },
          ],
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
      stream.end(file.buffer);
    });

    master.avatarUrl = uploaded.secure_url;
    master.avatarPublicId = uploaded.public_id;
    await master.save();

    return res.json({
      success: true,
      data: { user: safeMaster(master) },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Upload error",
    });
  }
}

export async function masterAvatarRemove(req: AuthRequest, res: Response) {
  try {
    const id = req.user?.id;

    if (!id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const master = await MasterModel.findById(id);
    if (!master) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (master.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(master.avatarPublicId);
      } catch {}
    }

    master.avatarUrl = "";
    master.avatarPublicId = "";
    await master.save();

    return res.json({
      success: true,
      data: { user: safeMaster(master) },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Remove error",
    });
  }
}