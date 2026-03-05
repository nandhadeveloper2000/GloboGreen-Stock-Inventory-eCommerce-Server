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

  function safeMaster(doc: any) {
    const o = doc.toObject ? doc.toObject() : doc;
    delete o.pinHash;
    delete o.refreshTokenHash;
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
/* ===================== AUTH ===================== */
// ✅ GOOGLE LOGIN (public)
export async function masterGoogleLogin(req: AuthRequest, res: Response) {
  const { idToken } = req.body as any;

  if (!idToken) {
    return res.status(400).json({ success: false, message: "idToken required" });
  }

  let g;
  try {
    g = await verifyGoogleIdToken(String(idToken));
  } catch (e) {
    return res.status(401).json({ success: false, message: "Invalid Google token" });
  }

  // ✅ IMPORTANT SECURITY:
  // Only allow emails you trust as MASTER
  const allow = getAllowedMasterEmails();
  if (allow.size > 0 && !allow.has(g.email)) {
    return res.status(403).json({ success: false, message: "Not allowed as master" });
  }

  // Find existing master by email or googleSub
  let master = await MasterModel.findOne({
    $or: [{ email: g.email }, { googleSub: g.sub }],
  });

  // If not exist, create master
  if (!master) {
    // Create a unique username
    const base = g.email.split("@")[0].replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    let username = `master_${base}`;
    const exists = await MasterModel.findOne({ username });
    if (exists) username = `master_${base}_${Date.now()}`;

    // pinHash must exist in your schema — set a random unusable pin OR allow pin empty by schema change
    // Here: generate a random pin so local pin login is not possible unless you later reset pin
    const randomPin = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    const pinHash = await hashPin(randomPin);

    master = await MasterModel.create({
      name: g.name || "Master Admin",
      username,
      email: g.email,
      avatarUrl: g.picture || "",
      googleSub: g.sub,
      pinHash,
      role: "MASTER_ADMIN",
      isActive: true,
    });
  } else {
    // update googleSub + avatar/name if empty
    if (!master.googleSub) master.googleSub = g.sub;
    if (!master.avatarUrl && g.picture) master.avatarUrl = g.picture;
    if (g.name && master.name !== g.name) master.name = g.name;
  }

  if (!master.isActive) {
    return res.status(403).json({ success: false, message: "Account disabled" });
  }

  const role = toRole(master.role, "MASTER_ADMIN");

  const accessToken = signAccessToken(master._id.toString(), role);
  const refreshToken = signRefreshToken(master._id.toString(), role);

  master.refreshTokenHash = await hashPin(refreshToken);
  await master.save();

  return res.json({
    success: true,
    data: { accessToken, refreshToken, user: safeMaster(master) },
  });
}
// ✅ LOGIN (public)
export async function masterLogin(req: AuthRequest, res: Response) {
  const { login, pin } = req.body as any;

  if (!login || !pin) {
    return res
      .status(400)
      .json({ success: false, message: "login and pin required" });
  }

  const loginStr = String(login).trim();
  const pinStr = String(pin).trim();

  // 1️⃣ Try DB login first
  let master = await MasterModel.findOne({
    $or: [
      { email: loginStr.toLowerCase() },
      { username: loginStr.toLowerCase() },
    ],
  });

  // 2️⃣ If not found → try ENV seed login
  if (!master) {
    const seeds = [
      { login: process.env.MASTER_LOGIN_1, pin: process.env.MASTER_PIN_1 },
      { login: process.env.MASTER_LOGIN_2, pin: process.env.MASTER_PIN_2 },
    ].filter((s) => s.login && s.pin);

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

    // Seed matched → create or find master
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

  // 3️⃣ Active check
  if (!master.isActive) {
    return res
      .status(403)
      .json({ success: false, message: "Account disabled" });
  }

  // 4️⃣ Validate PIN
  const isValid = await comparePin(pinStr, master.pinHash);
  if (!isValid) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  // 5️⃣ Normalize role
  const role = toRole(master.role, "MASTER_ADMIN");

  // 6️⃣ Generate tokens
  const accessToken = signAccessToken(master._id.toString(), role);
  const refreshToken = signRefreshToken(master._id.toString(), role);

  // 7️⃣ Store hashed refresh token
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
    return res.status(400).json({ success: false, message: "refreshToken required" });
  }

  let payload: any;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ success: false, message: "Invalid refresh token" });
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

  return res.json({ success: true, data: { accessToken: newAccessToken } });
}

// ✅ LOGOUT (public)
export async function masterLogout(req: AuthRequest, res: Response) {
  const { refreshToken } = req.body as any;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: "refreshToken required" });
  }

  let payload: any;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ success: false, message: "Invalid refresh token" });
  }

  const master = await MasterModel.findById(payload.sub);
  if (master) {
    master.refreshTokenHash = "";
    await master.save();
  }

  return res.json({ success: true, message: "Logged out" });
}

/* ===================== PROTECTED ===================== */

// ✅ ME
export async function masterMe(req: AuthRequest, res: Response) {
  const id = req.user?.id;
  if (!id) return res.status(401).json({ success: false, message: "Unauthorized" });

  const master = await MasterModel.findById(id);
  if (!master || !master.isActive) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  return res.json({ success: true, data: { user: safeMaster(master) } });
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

  return res.json({ success: true, data: { user: safeMaster(master) } });
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
    const exists = await MasterModel.findOne({ username: uname, _id: { $ne: master._id } });
    if (exists) {
      return res.status(409).json({ success: false, message: "username already exists" });
    }
    master.username = uname;
  }

  if (typeof email === "string" && email.trim()) {
    const em = email.trim().toLowerCase();
    const exists = await MasterModel.findOne({ email: em, _id: { $ne: master._id } });
    if (exists) {
      return res.status(409).json({ success: false, message: "email already exists" });
    }
    master.email = em;
  }

  if (typeof avatarUrl === "string") master.avatarUrl = avatarUrl.trim();
  if (typeof avatarPublicId === "string") master.avatarPublicId = avatarPublicId.trim();

  if (typeof isActive === "boolean") {
    if (req.user?.id === master._id.toString() && isActive === false) {
      return res
        .status(400)
        .json({ success: false, message: "You cannot disable your own account" });
    }
    master.isActive = isActive;
  }

  if (role !== undefined) {
    master.role = toRole(role, "MASTER_ADMIN");
  }

  if (pin !== undefined) {
    const pinStr = String(pin ?? "").trim();
    if (pinStr.length < 4) {
      return res.status(400).json({ success: false, message: "pin must be at least 4 digits" });
    }
    master.pinHash = await hashPin(pinStr);
    master.refreshTokenHash = "";
  }

  await master.save();
  return res.json({ success: true, data: { user: safeMaster(master) } });
}

export async function masterDelete(req: AuthRequest, res: Response) {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: "Invalid id" });
  }

  if (req.user?.id === id) {
    return res.status(400).json({ success: false, message: "You cannot delete your own account" });
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
    if (!id) return res.status(401).json({ success: false, message: "Unauthorized" });

    const file = (req as any).file as { buffer: Buffer; mimetype?: string } | undefined;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, message: "avatar file required" });
    }

    const master = await MasterModel.findById(id);
    if (!master) return res.status(404).json({ success: false, message: "Not found" });

    // delete old
    if (master.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(master.avatarPublicId);
      } catch {}
    }

    // upload new
    const uploaded: any = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "Shop Stack/masters",
          resource_type: "image",
          transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
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

    return res.json({ success: true, data: { user: safeMaster(master) } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Upload error" });
  }
}

export async function masterAvatarRemove(req: AuthRequest, res: Response) {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ success: false, message: "Unauthorized" });

    const master = await MasterModel.findById(id);
    if (!master) return res.status(404).json({ success: false, message: "Not found" });

    if (master.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(master.avatarPublicId);
      } catch {}
    }

    master.avatarUrl = "";
    master.avatarPublicId = "";
    await master.save();

    return res.json({ success: true, data: { user: safeMaster(master) } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Remove error" });
  }
}