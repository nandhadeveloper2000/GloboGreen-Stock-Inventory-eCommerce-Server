import type { Response } from "express";
import { isValidObjectId } from "mongoose";
import { MasterModel } from "../models/master.model";
import { comparePin, hashPin } from "../utils/pin";
import cloudinary from "../config/cloudinary";
import type { Role } from "../utils/jwt";
import type { AuthRequest } from "../types/auth";
import { verifyGoogleIdToken } from "../utils/google";
import { generateOtp } from "../utils/otp";
import { sendEmail } from "../utils/sendEmail";
import { buildOtpEmailTemplate } from "../utils/emailTemplates";
import {
  createLoginSession,
  revokeAllUserSessions,
} from "./auth.controller";
import {
  assertLoginNotBlocked,
  registerLoginFailure,
  clearLoginFailures,
} from "../utils/loginProtection";

function safeMaster(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;

  delete o.pinHash;
  delete o.pinResetOtp;
  delete o.pinResetOtpExpiresAt;
  delete o.refreshTokenHash;
  delete o.__v;

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

function toRole(input: unknown, fallback: Role = "MASTER_ADMIN"): Role {
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

function getAuthUserId(req: AuthRequest) {
  return String(req.user?.sub || req.user?.id || "").trim();
}

/* ===================== AUTH ===================== */

export async function masterLogin(req: AuthRequest, res: Response) {
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

    const loginStr = String(login).trim();
    const loginLower = loginStr.toLowerCase();
    const pinStr = String(pin).trim();
    const ipAddress = req.ip;

    await assertLoginNotBlocked({
      login: loginStr,
      ipAddress,
    });

    let master = await MasterModel.findOne({
      $or: [{ email: loginLower }, { username: loginLower }],
    }).select("+pinHash");

    if (!master) {
      const seeds = getSeeds();

      const matchedSeed = seeds.find(
        (s) =>
          String(s.login).trim() === loginStr &&
          String(s.pin).trim() === pinStr
      );

      if (!matchedSeed) {
        await registerLoginFailure({
          login: loginStr,
          ipAddress,
        });

        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      const username = `master_${loginStr}`.toLowerCase();
      const email = `master_${loginStr}@seed.local`.toLowerCase();

      master = await MasterModel.findOne({ username }).select("+pinHash");

      if (!master) {
        const created = await MasterModel.create({
          name: "Master Admin",
          username,
          email,
          pinHash: await hashPin(pinStr),
          role: "MASTER_ADMIN",
          isActive: true,
        });

        master = await MasterModel.findById(created._id).select("+pinHash");
      }
    }

    if (!master) {
      await registerLoginFailure({
        login: loginStr,
        ipAddress,
      });

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (!master.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    const isValid = await comparePin(pinStr, master.pinHash);
    if (!isValid) {
      await registerLoginFailure({
        login: loginStr,
        ipAddress,
      });

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    await clearLoginFailures({
      login: loginStr,
      ipAddress,
    });

    const role = toRole(master.role, "MASTER_ADMIN");

    const session = await createLoginSession({
      userId: master._id.toString(),
      userModel: "Master",
      role,
      deviceName: String(deviceName || ""),
      platform: String(platform || ""),
      appVersion: String(appVersion || ""),
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || "",
    });

    return res.json({
      success: true,
      data: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        role,
        user: safeMaster(master),
      },
    });
  } catch (e: any) {
    if (String(e?.message || "").startsWith("Too many failed attempts")) {
      return res.status(429).json({
        success: false,
        message: e.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: e?.message || "Login failed",
    });
  }
}

/* ===================== GOOGLE AUTH ===================== */

export async function masterGoogleLogin(req: AuthRequest, res: Response) {
  try {
    const { idToken, deviceName, platform, appVersion } = req.body as {
      idToken?: string;
      deviceName?: string;
      platform?: string;
      appVersion?: string;
    };

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "idToken required",
      });
    }

    const googleUser = await verifyGoogleIdToken(idToken);
    const email = String(googleUser.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Google account email not found",
      });
    }

    const allowedEmails = getAllowedMasterEmails();
    if (allowedEmails.size > 0 && !allowedEmails.has(email)) {
      return res.status(403).json({
        success: false,
        message: "This Google account is not allowed for master login",
      });
    }

    let master = await MasterModel.findOne({ email }).select("+pinHash");

    if (!master) {
      const usernameBase = email.split("@")[0].toLowerCase();
      let username = usernameBase;
      let count = 1;

      while (await MasterModel.findOne({ username })) {
        username = `${usernameBase}_${count++}`;
      }

      const randomPin = generateOtp(6);

      const created = await MasterModel.create({
        name: googleUser.name || "Master Admin",
        username,
        email,
        pinHash: await hashPin(randomPin),
        role: "MASTER_ADMIN",
        isActive: true,
        googleSub: googleUser.sub || "",
      });

      master = await MasterModel.findById(created._id).select("+pinHash");
    } else if (!master.googleSub && googleUser.sub) {
      master.googleSub = googleUser.sub;
      await master.save();
    }

    if (!master || !master.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    const role = toRole(master.role, "MASTER_ADMIN");

    const session = await createLoginSession({
      userId: master._id.toString(),
      userModel: "Master",
      role,
      deviceName: String(deviceName || ""),
      platform: String(platform || ""),
      appVersion: String(appVersion || ""),
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || "",
    });

    return res.json({
      success: true,
      data: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        role,
        user: safeMaster(master),
      },
    });
  } catch (e: any) {
    return res.status(401).json({
      success: false,
      message: e?.message || "Google login failed",
    });
  }
}

/* ===================== PIN MANAGEMENT ===================== */

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
    }).select("+pinResetOtp +pinResetOtpExpiresAt");

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

    await sendEmail({
      to: master.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html,
    });

    master.pinResetOtp = otp;
    master.pinResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
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

    if (!/^\d{4,8}$/.test(pinStr)) {
      return res.status(400).json({
        success: false,
        message: "newPin must be 4 to 8 digits",
      });
    }

    const master = await MasterModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }],
    }).select("+pinHash +pinResetOtp +pinResetOtpExpiresAt");

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

    const savedOtp = String(master.pinResetOtp || "").trim();
    const expiresAt = master.pinResetOtpExpiresAt
      ? new Date(master.pinResetOtpExpiresAt)
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
    master.pinResetOtp = "";
    master.pinResetOtpExpiresAt = null;
    await master.save();

    await revokeAllUserSessions(master._id.toString(), "MASTER_ADMIN");

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

export async function masterChangePin(req: AuthRequest, res: Response) {
  try {
    const id = getAuthUserId(req);

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

    if (!/^\d{4,8}$/.test(newPinStr)) {
      return res.status(400).json({
        success: false,
        message: "newPin must be 4 to 8 digits",
      });
    }

    const master = await MasterModel.findById(id).select(
      "+pinHash +pinResetOtp +pinResetOtpExpiresAt"
    );

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
    master.pinResetOtp = "";
    master.pinResetOtpExpiresAt = null;
    await master.save();

    await revokeAllUserSessions(master._id.toString(), "MASTER_ADMIN");

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

export async function masterMe(req: AuthRequest, res: Response) {
  try {
    const id = getAuthUserId(req);

    if (!id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const master = await MasterModel.findById(id);
    if (!master || !master.isActive) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    return res.json({
      success: true,
      data: { user: safeMaster(master) },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to fetch profile",
    });
  }
}

export async function masterUpdateMe(req: AuthRequest, res: Response) {
  try {
    const id = getAuthUserId(req);

    if (!id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const master = await MasterModel.findById(id).select(
      "+pinHash +pinResetOtp +pinResetOtpExpiresAt"
    );

    if (!master || !master.isActive) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { name, username, email, mobile, additionalNumber } = req.body as {
      name?: string;
      username?: string;
      email?: string;
      mobile?: string;
      additionalNumber?: string;
    };

    if (typeof name === "string") {
      master.name = name.trim();
    }

    if (typeof username === "string" && username.trim()) {
      const uname = username.trim().toLowerCase();

      const exists = await MasterModel.findOne({
        username: uname,
        _id: { $ne: master._id },
      });

      if (exists) {
        return res.status(409).json({
          success: false,
          message: "username already exists",
        });
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
        return res.status(409).json({
          success: false,
          message: "email already exists",
        });
      }

      master.email = em;
    }

    if (typeof mobile === "string") {
      (master as any).mobile = mobile.trim();
    }

    if (typeof additionalNumber === "string") {
      (master as any).additionalNumber = additionalNumber.trim();
    }

    await master.save();

    return res.json({
      success: true,
      data: { user: safeMaster(master) },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to update profile",
    });
  }
}

/* ===================== ADMIN CRUD ===================== */

export async function masterList(req: AuthRequest, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const q = String(req.query.q || "").trim();

    const filter: Record<string, any> = {};

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
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to list masters",
    });
  }
}

export async function masterGetById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const master = await MasterModel.findById(id);
    if (!master) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    return res.json({
      success: true,
      data: { user: safeMaster(master) },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to fetch master",
    });
  }
}

export async function masterUpdate(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const master = await MasterModel.findById(id).select(
      "+pinHash +pinResetOtp +pinResetOtpExpiresAt"
    );

    if (!master) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    const {
      name,
      username,
      email,
      mobile,
      additionalNumber,
      role,
      isActive,
      avatarUrl,
      avatarPublicId,
      pin,
    } = req.body as {
      name?: string;
      username?: string;
      email?: string;
      mobile?: string;
      additionalNumber?: string;
      role?: string;
      isActive?: boolean;
      avatarUrl?: string;
      avatarPublicId?: string;
      pin?: string;
    };

    if (typeof name === "string") {
      master.name = name.trim();
    }

    if (typeof username === "string" && username.trim()) {
      const uname = username.trim().toLowerCase();
      const exists = await MasterModel.findOne({
        username: uname,
        _id: { $ne: master._id },
      });

      if (exists) {
        return res.status(409).json({
          success: false,
          message: "username already exists",
        });
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
        return res.status(409).json({
          success: false,
          message: "email already exists",
        });
      }

      master.email = em;
    }

    if (typeof mobile === "string") {
      (master as any).mobile = mobile.trim();
    }

    if (typeof additionalNumber === "string") {
      (master as any).additionalNumber = additionalNumber.trim();
    }

    if (typeof avatarUrl === "string") {
      master.avatarUrl = avatarUrl.trim();
    }

    if (typeof avatarPublicId === "string") {
      master.avatarPublicId = avatarPublicId.trim();
    }

    if (typeof isActive === "boolean") {
      const authUserId = getAuthUserId(req);

      if (authUserId === master._id.toString() && isActive === false) {
        return res.status(400).json({
          success: false,
          message: "You cannot disable your own account",
        });
      }

      master.isActive = isActive;

      if (!isActive) {
        await revokeAllUserSessions(master._id.toString(), "MASTER_ADMIN");
      }
    }

    if (role !== undefined) {
      const normalizedRole = String(role).trim().toUpperCase();

      if (normalizedRole !== "MASTER_ADMIN") {
        return res.status(400).json({
          success: false,
          message: "Master role can only be MASTER_ADMIN",
        });
      }

      master.role = "MASTER_ADMIN";
    }

    if (pin !== undefined) {
      const pinStr = String(pin ?? "").trim();

      if (!/^\d{4,8}$/.test(pinStr)) {
        return res.status(400).json({
          success: false,
          message: "pin must be 4 to 8 digits",
        });
      }

      master.pinHash = await hashPin(pinStr);
      master.pinResetOtp = "";
      master.pinResetOtpExpiresAt = null;
      await master.save();

      await revokeAllUserSessions(master._id.toString(), "MASTER_ADMIN");

      return res.json({
        success: true,
        data: { user: safeMaster(master) },
      });
    }

    await master.save();

    return res.json({
      success: true,
      data: { user: safeMaster(master) },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Update failed",
    });
  }
}

export async function masterDelete(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const authUserId = getAuthUserId(req);

    if (authUserId === id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const master = await MasterModel.findById(id);
    if (!master) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    await revokeAllUserSessions(master._id.toString(), "MASTER_ADMIN");
    await MasterModel.deleteOne({ _id: id });

    return res.json({
      success: true,
      message: "Deleted",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Delete failed",
    });
  }
}

export async function masterAvatarUpload(req: AuthRequest, res: Response) {
  try {
    const id = getAuthUserId(req);

    if (!id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const file = (req as any).file as
      | { buffer: Buffer; mimetype?: string }
      | undefined;

    if (!file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "avatar file required",
      });
    }

    const master = await MasterModel.findById(id);
    if (!master) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
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
    const id = getAuthUserId(req);

    if (!id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const master = await MasterModel.findById(id);
    if (!master) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
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