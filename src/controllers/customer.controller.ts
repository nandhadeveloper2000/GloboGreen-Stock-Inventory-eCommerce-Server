import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

import { CustomerModel } from "../models/customer.model";
import { generateOtp, hashOtp, verifyOtp } from "../utils/otp";
import { sendEmailOtp } from "../utils/sendEmailOtp";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";

import { uploadImage } from "../utils/uploadImage";
import { deleteImage } from "../utils/deleteImage";

/* ----------------------------- helpers ----------------------------- */

function isObjectId(id: any) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

const normTrim = (v: any) => String(v ?? "").trim();
const normLower = (v: any) => String(v ?? "").trim().toLowerCase();

function safeCustomer(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;

  delete o.refreshTokenHash;
  delete o.otpHash;
  delete o.otpAttempts;
  delete o.otpExpiresAt;
  delete o.otpLastSentAt;

  return o;
}

function ensureSingleDefaultAddress(addresses: any[]) {
  if (!Array.isArray(addresses)) return [];
  let found = false;

  return addresses.map((a) => {
    const isDef = Boolean(a?.isDefault);
    if (isDef && !found) {
      found = true;
      return { ...a, isDefault: true };
    }
    if (isDef && found) return { ...a, isDefault: false };
    return a;
  });
}

function parseAddressesFromBody(raw: any): any[] | undefined {
  if (raw === undefined) return undefined;
  const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  return ensureSingleDefaultAddress(Array.isArray(arr) ? arr : []);
}

/* ============================= AUTH (OTP) ============================= */

/**
 * POST /api/customer/auth/request-otp
 * body: { email }
 */
export async function customerRequestOtp(req: Request, res: Response) {
  try {
    const email = normLower(req.body?.email);
    if (!email) return res.status(400).json({ success: false, message: "email required" });

    const now = new Date();

    let customer = await CustomerModel.findOne({ email }).select(
      "+otpLastSentAt +otpAttempts +otpHash +otpExpiresAt"
    );

    if (!customer) {
      await CustomerModel.create({ email, verifyEmail: false, isActive: true });
      customer = await CustomerModel.findOne({ email }).select(
        "+otpLastSentAt +otpAttempts +otpHash +otpExpiresAt"
      );
    }

    if (!customer) return res.status(500).json({ success: false, message: "Customer create failed" });
    if (!customer.isActive) return res.status(403).json({ success: false, message: "Account inactive" });

    // throttle: 60 seconds
    const last = (customer as any).otpLastSentAt as Date | null;
    if (last && now.getTime() - last.getTime() < 60_000) {
      return res.status(429).json({ success: false, message: "OTP already sent. Try after 60 seconds" });
    }

    const otp = generateOtp(6);
    const otpHashStr = await hashOtp(otp);
    const expires = new Date(Date.now() + 5 * 60_000); // 5 mins

    await CustomerModel.updateOne(
      { _id: customer._id },
      {
        $set: {
          otpHash: otpHashStr,
          otpExpiresAt: expires,
          otpAttempts: 0,
          otpLastSentAt: now,
        },
      }
    );

    await sendEmailOtp(email, otp);

    return res.json({ success: true, message: "OTP sent to email" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * POST /api/customer/auth/verify-otp
 * body: { email, otp }
 */
export async function customerVerifyOtp(req: Request, res: Response) {
  try {
    const email = normLower(req.body?.email);
    const otp = normTrim(req.body?.otp);

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "email and otp required" });
    }

    const customer = await CustomerModel.findOne({ email }).select(
      "+otpHash +otpExpiresAt +otpAttempts +refreshTokenHash"
    );

    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    if (!customer.isActive) return res.status(403).json({ success: false, message: "Account inactive" });

    const attempts = (customer as any).otpAttempts || 0;
    if (attempts >= 5) {
      return res.status(429).json({ success: false, message: "Too many attempts. Request new OTP" });
    }

    const exp = (customer as any).otpExpiresAt as Date | null;
    if (!exp || exp.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "OTP expired. Request new OTP" });
    }

    const hash = (customer as any).otpHash as string;
    const ok = hash ? await verifyOtp(otp, hash) : false;

    if (!ok) {
      await CustomerModel.updateOne({ _id: customer._id }, { $inc: { otpAttempts: 1 } });
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    const accessToken = signAccessToken(String(customer._id), "CUSTOMER");
    const refreshToken = signRefreshToken(String(customer._id), "CUSTOMER");

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await CustomerModel.updateOne(
      { _id: customer._id },
      {
        $set: { refreshTokenHash, verifyEmail: true },
        $unset: { otpHash: "", otpExpiresAt: "", otpAttempts: "", otpLastSentAt: "" },
      }
    );

    const fresh = await CustomerModel.findById(customer._id);
    return res.json({
      success: true,
      message: "Login success",
      data: safeCustomer(fresh),
      tokens: { accessToken, refreshToken },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * POST /api/customer/auth/refresh
 * body: { refreshToken }
 */
export async function customerRefresh(req: Request, res: Response) {
  try {
    const refreshToken = normTrim(req.body?.refreshToken);
    if (!refreshToken) return res.status(400).json({ success: false, message: "refreshToken required" });

    let decoded: any;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid/expired refresh token" });
    }

    if (!decoded?.sub || decoded?.role !== "CUSTOMER") {
      return res.status(401).json({ success: false, message: "Invalid refresh payload" });
    }

    const customer = await CustomerModel.findById(decoded.sub).select("+refreshTokenHash");
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    if (!customer.isActive) return res.status(403).json({ success: false, message: "Account inactive" });

    const hash = (customer as any).refreshTokenHash as string;
    const ok = hash ? await bcrypt.compare(refreshToken, hash) : false;
    if (!ok) return res.status(401).json({ success: false, message: "Refresh token mismatch" });

    const newAccessToken = signAccessToken(String(customer._id), "CUSTOMER");
    return res.json({ success: true, tokens: { accessToken: newAccessToken } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/**
 * POST /api/customer/auth/logout  (protected)
 */
export async function customerLogout(req: Request, res: Response) {
  try {
    const u = (req as any).user;
    if (!u?.sub || u.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await CustomerModel.updateOne({ _id: u.sub }, { $set: { refreshTokenHash: "" } });
    return res.json({ success: true, message: "Logged out" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/* ============================= CRUD (ADMIN) ============================= */

/** POST /api/customer  (multipart/form-data: avatar optional) */
export async function createCustomer(req: Request, res: Response) {
  try {
    const name = normTrim(req.body?.name);
    const mobile = normTrim(req.body?.mobile);
    const email = req.body?.email !== undefined ? normLower(req.body?.email) : "";
    const isActive = req.body?.isActive ?? true;

    const addresses = parseAddressesFromBody(req.body?.addresses) ?? [];

    if (!mobile) return res.status(400).json({ success: false, message: "mobile required" });

    const existing = await CustomerModel.findOne({ mobile });
    if (existing) return res.status(409).json({ success: false, message: "mobile already exists" });

    let avatarUrl = "";
    let avatarPublicId = "";

    if (req.file) {
      const up = await uploadImage(req.file, "customers/avatars");
      avatarUrl = up.url;
      avatarPublicId = up.publicId;
    }

    const created = await CustomerModel.create({
      name,
      mobile,
      email,
      isActive: Boolean(isActive),
      avatarUrl,
      avatarPublicId,
      addresses,
    });

    return res.status(201).json({ success: true, data: safeCustomer(created) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/** GET /api/customer?search=&page=&limit= */
export async function listCustomers(req: Request, res: Response) {
  try {
    const search = normTrim(req.query?.search);
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
    const skip = (page - 1) * limit;

    const q: any = {};
    if (search) {
      q.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      CustomerModel.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit),
      CustomerModel.countDocuments(q),
    ]);

    return res.json({
      success: true,
      data: items.map(safeCustomer),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/** GET /api/customer/:id */
export async function getCustomer(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const customer = await CustomerModel.findById(id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    return res.json({ success: true, data: safeCustomer(customer) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/** PUT /api/customer/:id (multipart/form-data: avatar optional) */
export async function updateCustomer(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const customer = await CustomerModel.findById(id).select("+refreshTokenHash");
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    const name = req.body?.name !== undefined ? normTrim(req.body?.name) : undefined;
    const mobile = req.body?.mobile !== undefined ? normTrim(req.body?.mobile) : undefined;
    const email = req.body?.email !== undefined ? normLower(req.body?.email) : undefined;
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body?.isActive) : undefined;

    const addresses = parseAddressesFromBody(req.body?.addresses);
    if (addresses !== undefined) (customer as any).addresses = addresses;

    if (mobile && mobile !== (customer as any).mobile) {
      const exists = await CustomerModel.findOne({ mobile, _id: { $ne: customer._id } });
      if (exists) return res.status(409).json({ success: false, message: "mobile already exists" });
      (customer as any).mobile = mobile;
    }

    if (name !== undefined) (customer as any).name = name;
    if (email !== undefined) (customer as any).email = email;
    if (isActive !== undefined) (customer as any).isActive = isActive;

    if (req.file) {
      if ((customer as any).avatarPublicId) await deleteImage((customer as any).avatarPublicId);

      const up = await uploadImage(req.file, "customers/avatars");
      (customer as any).avatarUrl = up.url;
      (customer as any).avatarPublicId = up.publicId;
    }

    await customer.save();

    const fresh = await CustomerModel.findById(customer._id);
    return res.json({ success: true, data: safeCustomer(fresh) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/** DELETE /api/customer/:id */
export async function deleteCustomer(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const customer = await CustomerModel.findById(id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    if ((customer as any).avatarPublicId) await deleteImage((customer as any).avatarPublicId);

    await CustomerModel.deleteOne({ _id: customer._id });
    return res.json({ success: true, message: "Customer deleted" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}
export async function getMyCustomerProfile(req: Request, res: Response) {
  try {
    const u = (req as any).user;
    if (!u?.sub || u.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const me = await CustomerModel.findById(u.sub);
    if (!me) return res.status(404).json({ success: false, message: "Customer not found" });

    return res.json({ success: true, data: safeCustomer(me) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function updateMyCustomerProfile(req: Request, res: Response) {
  try {
    const u = (req as any).user;
    if (!u?.sub || u.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const customer = await CustomerModel.findById(u.sub).select("+refreshTokenHash");
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    const name = req.body?.name !== undefined ? normTrim(req.body?.name) : undefined;
    const email = req.body?.email !== undefined ? normLower(req.body?.email) : undefined;

    const addresses = parseAddressesFromBody(req.body?.addresses);
    if (addresses !== undefined) (customer as any).addresses = addresses;

    if (name !== undefined) (customer as any).name = name;
    if (email !== undefined) (customer as any).email = email;

    if (req.file) {
      if ((customer as any).avatarPublicId) await deleteImage((customer as any).avatarPublicId);
      const up = await uploadImage(req.file, "customers/avatars");
      (customer as any).avatarUrl = up.url;
      (customer as any).avatarPublicId = up.publicId;
    }

    await customer.save();
    const fresh = await CustomerModel.findById(customer._id);
    return res.json({ success: true, data: safeCustomer(fresh) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}