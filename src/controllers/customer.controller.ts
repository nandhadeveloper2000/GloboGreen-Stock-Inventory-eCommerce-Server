import { Request, Response } from "express";
import mongoose from "mongoose";

import { CustomerModel } from "../models/customer.model";
import { generateOtp, hashOtp, verifyOtp } from "../utils/otp";
import { sendEmailOtp } from "../utils/sendEmailOtp";
import { uploadImage } from "../utils/uploadImage";
import { deleteImage } from "../utils/deleteImage";
import { createLoginSession } from "./auth.controller";

/* ----------------------------- helpers ----------------------------- */

function isObjectId(id: unknown) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

const normTrim = (v: unknown) => String(v ?? "").trim();
const normLower = (v: unknown) => String(v ?? "").trim().toLowerCase();

function safeCustomer(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;

  delete o.otpHash;
  delete o.otpAttempts;
  delete o.otpExpiresAt;
  delete o.otpLastSentAt;
  delete o.refreshTokenHash;
  delete o.__v;

  return o;
}

function ensureSingleDefaultAddress(addresses: any[]) {
  if (!Array.isArray(addresses)) return [];

  let foundDefault = false;

  return addresses.map((a) => {
    const isDefault = Boolean(a?.isDefault);

    if (isDefault && !foundDefault) {
      foundDefault = true;
      return { ...a, isDefault: true };
    }

    if (isDefault && foundDefault) {
      return { ...a, isDefault: false };
    }

    return { ...a, isDefault: false };
  });
}

function parseAddressesFromBody(raw: unknown): any[] | undefined {
  if (raw === undefined) return undefined;

  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return ensureSingleDefaultAddress(Array.isArray(arr) ? arr : []);
  } catch {
    throw new Error("Invalid addresses JSON");
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;

  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;

  return undefined;
}

function getClientMeta(req: Request) {
  return {
    deviceName: String(req.headers["x-device-name"] || ""),
    platform: String(req.headers["x-platform"] || ""),
    appVersion: String(req.headers["x-app-version"] || ""),
    ipAddress:
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "",
    userAgent: String(req.headers["user-agent"] || ""),
  };
}

/* ============================= AUTH (OTP) ============================= */

export async function customerRequestOtp(req: Request, res: Response) {
  try {
    const email = normLower(req.body?.email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "email required",
      });
    }

    const now = new Date();

    let customer = await CustomerModel.findOne({ email }).select(
      "+otpLastSentAt +otpAttempts +otpHash +otpExpiresAt"
    );

    if (!customer) {
      customer = await CustomerModel.create({
        email,
        verifyEmail: false,
        isActive: true,
      });

      customer = await CustomerModel.findById(customer._id).select(
        "+otpLastSentAt +otpAttempts +otpHash +otpExpiresAt"
      );
    }

    if (!customer) {
      return res.status(500).json({
        success: false,
        message: "Customer create failed",
      });
    }

    if (!customer.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account inactive",
      });
    }

    const last = (customer as any).otpLastSentAt as Date | null;
    if (last && now.getTime() - last.getTime() < 60_000) {
      return res.status(429).json({
        success: false,
        message: "OTP already sent. Try after 60 seconds",
      });
    }

    const otp = generateOtp(6);
    const otpHashStr = await hashOtp(otp);
    const expires = new Date(Date.now() + 5 * 60_000);

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

    return res.json({
      success: true,
      message: "OTP sent to email",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

export async function customerVerifyOtp(req: Request, res: Response) {
  try {
    const email = normLower(req.body?.email);
    const otp = normTrim(req.body?.otp);

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "email and otp required",
      });
    }

    const customer = await CustomerModel.findOne({ email }).select(
      "+otpHash +otpExpiresAt +otpAttempts"
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (!customer.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account inactive",
      });
    }

    const attempts = (customer as any).otpAttempts || 0;
    if (attempts >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Request new OTP",
      });
    }

    const exp = (customer as any).otpExpiresAt as Date | null;
    if (!exp || exp.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired. Request new OTP",
      });
    }

    const hash = (customer as any).otpHash as string;
    const ok = hash ? await verifyOtp(otp, hash) : false;

    if (!ok) {
      await CustomerModel.updateOne(
        { _id: customer._id },
        { $inc: { otpAttempts: 1 } }
      );

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await CustomerModel.updateOne(
      { _id: customer._id },
      {
        $set: { verifyEmail: true },
        $unset: {
          otpHash: "",
          otpExpiresAt: "",
          otpAttempts: "",
          otpLastSentAt: "",
        },
      }
    );

    const session = await createLoginSession({
      userId: String(customer._id),
      role: "CUSTOMER",
      userModel: "Customer",
      ...getClientMeta(req),
    });

    const fresh = await CustomerModel.findById(customer._id);

    return res.json({
      success: true,
      message: "Login success",
      data: safeCustomer(fresh),
      tokens: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      },
      session: {
        sid: session.sid,
        userModel: session.userModel,
      },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

/* ============================= CRUD (ADMIN) ============================= */

export async function createCustomer(req: Request, res: Response) {
  try {
    const name = normTrim(req.body?.name);
    const mobile =
      req.body?.mobile !== undefined ? normTrim(req.body?.mobile) : "";
    const email =
      req.body?.email !== undefined ? normLower(req.body?.email) : "";
    const isActive = parseBoolean(req.body?.isActive) ?? true;

    const addresses = parseAddressesFromBody(req.body?.addresses) ?? [];

    if (mobile) {
      const existingMobile = await CustomerModel.findOne({ mobile });
      if (existingMobile) {
        return res.status(409).json({
          success: false,
          message: "mobile already exists",
        });
      }
    }

    if (email) {
      const existingEmail = await CustomerModel.findOne({ email });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: "email already exists",
        });
      }
    }

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
      isActive,
      avatarUrl,
      avatarPublicId,
      addresses,
    });

    return res.status(201).json({
      success: true,
      data: safeCustomer(created),
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

export async function listCustomers(req: Request, res: Response) {
  try {
    const search = normTrim(req.query?.search);
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
    const skip = (page - 1) * limit;

    const query: any = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      CustomerModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      CustomerModel.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: items.map(safeCustomer),
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

export async function getCustomer(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const customer = await CustomerModel.findById(id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.json({
      success: true,
      data: safeCustomer(customer),
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

export async function updateCustomer(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const customer = await CustomerModel.findById(id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const name =
      req.body?.name !== undefined ? normTrim(req.body?.name) : undefined;
    const mobile =
      req.body?.mobile !== undefined ? normTrim(req.body?.mobile) : undefined;
    const email =
      req.body?.email !== undefined ? normLower(req.body?.email) : undefined;
    const isActive = parseBoolean(req.body?.isActive);

    const addresses = parseAddressesFromBody(req.body?.addresses);
    if (addresses !== undefined) {
      (customer as any).addresses = addresses;
    }

    if (mobile !== undefined && mobile !== customer.mobile) {
      if (mobile) {
        const exists = await CustomerModel.findOne({
          mobile,
          _id: { $ne: customer._id },
        });

        if (exists) {
          return res.status(409).json({
            success: false,
            message: "mobile already exists",
          });
        }
      }

      (customer as any).mobile = mobile;
    }

    if (email !== undefined && email !== customer.email) {
      if (email) {
        const exists = await CustomerModel.findOne({
          email,
          _id: { $ne: customer._id },
        });

        if (exists) {
          return res.status(409).json({
            success: false,
            message: "email already exists",
          });
        }
      }

      (customer as any).email = email;
    }

    if (name !== undefined) {
      (customer as any).name = name;
    }

    if (isActive !== undefined) {
      (customer as any).isActive = isActive;
    }

    if (req.file) {
      if ((customer as any).avatarPublicId) {
        await deleteImage((customer as any).avatarPublicId);
      }

      const up = await uploadImage(req.file, "customers/avatars");
      (customer as any).avatarUrl = up.url;
      (customer as any).avatarPublicId = up.publicId;
    }

    await customer.save();

    const fresh = await CustomerModel.findById(customer._id);

    return res.json({
      success: true,
      data: safeCustomer(fresh),
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

export async function deleteCustomer(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const customer = await CustomerModel.findById(id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if ((customer as any).avatarPublicId) {
      await deleteImage((customer as any).avatarPublicId);
    }

    await CustomerModel.deleteOne({ _id: customer._id });

    return res.json({
      success: true,
      message: "Customer deleted",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

/* ============================= CUSTOMER SELF ============================= */

export async function getMyCustomerProfile(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    if (!user?.sub || user.role !== "CUSTOMER") {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    const me = await CustomerModel.findById(user.sub);

    if (!me) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.json({
      success: true,
      data: safeCustomer(me),
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}

export async function updateMyCustomerProfile(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    if (!user?.sub || user.role !== "CUSTOMER") {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    const customer = await CustomerModel.findById(user.sub);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const name =
      req.body?.name !== undefined ? normTrim(req.body?.name) : undefined;
    const email =
      req.body?.email !== undefined ? normLower(req.body?.email) : undefined;

    const addresses = parseAddressesFromBody(req.body?.addresses);
    if (addresses !== undefined) {
      (customer as any).addresses = addresses;
    }

    if (name !== undefined) {
      (customer as any).name = name;
    }

    if (email !== undefined && email !== customer.email) {
      if (email) {
        const exists = await CustomerModel.findOne({
          email,
          _id: { $ne: customer._id },
        });

        if (exists) {
          return res.status(409).json({
            success: false,
            message: "email already exists",
          });
        }
      }

      (customer as any).email = email;
    }

    if (req.file) {
      if ((customer as any).avatarPublicId) {
        await deleteImage((customer as any).avatarPublicId);
      }

      const up = await uploadImage(req.file, "customers/avatars");
      (customer as any).avatarUrl = up.url;
      (customer as any).avatarPublicId = up.publicId;
    }

    await customer.save();

    const fresh = await CustomerModel.findById(customer._id);

    return res.json({
      success: true,
      data: safeCustomer(fresh),
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Server error",
    });
  }
}