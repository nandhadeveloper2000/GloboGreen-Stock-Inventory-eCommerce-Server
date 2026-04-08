import bcrypt from "bcrypt";
import { AuthSessionModel, type AuthUserModel } from "../models/authSession.model";
import {
  createSessionId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type Role,
} from "./jwt";

const REFRESH_TOKEN_DAYS = 30;
const MAX_SESSIONS_PER_USER = 3;

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function hashToken(token: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(token, salt);
}

export function roleToUserModel(role: Role): AuthUserModel {
  switch (role) {
    case "MASTER_ADMIN":
      return "Master";

    case "MANAGER":
    case "SUPERVISOR":
    case "STAFF":
      return "Staff";

    case "SHOP_OWNER":
      return "ShopOwner";

    case "SHOP_MANAGER":
    case "SHOP_SUPERVISOR":
    case "EMPLOYEE":
      return "ShopStaff";

    case "CUSTOMER":
      return "Customer";

    default:
      throw new Error(`Unsupported role: ${role}`);
  }
}

async function enforceSessionLimit(userId: string, userModel: AuthUserModel) {
  const activeSessions = await AuthSessionModel.find({
    userId,
    userModel,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .select("_id")
    .lean();

  const allowedExistingSessions = Math.max(MAX_SESSIONS_PER_USER - 1, 0);

  if (activeSessions.length <= allowedExistingSessions) {
    return;
  }

  const sessionsToRevoke = activeSessions.slice(allowedExistingSessions);

  if (sessionsToRevoke.length > 0) {
    await AuthSessionModel.updateMany(
      { _id: { $in: sessionsToRevoke.map((s) => s._id) } },
      { $set: { isRevoked: true } }
    );
  }
}

export async function createLoginSession(params: {
  userId: string;
  role: Role;
  userModel?: AuthUserModel;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const sid = createSessionId();
  const userModel = params.userModel ?? roleToUserModel(params.role);

  await enforceSessionLimit(params.userId, userModel);

  const accessToken = signAccessToken(params.userId, params.role, sid);
  const refreshToken = signRefreshToken(params.userId, params.role, sid);

  await AuthSessionModel.create({
    userId: params.userId,
    userModel,
    role: params.role,
    sid,
    refreshTokenHash: await hashToken(refreshToken),
    deviceName: params.deviceName || "",
    platform: params.platform || "",
    appVersion: params.appVersion || "",
    ipAddress: params.ipAddress || "",
    userAgent: params.userAgent || "",
    isRevoked: false,
    lastUsedAt: new Date(),
    expiresAt: addDays(REFRESH_TOKEN_DAYS),
  });

  return {
    sid,
    accessToken,
    refreshToken,
    userModel,
  };
}

export async function rotateSession(refreshToken: string) {
  const token = String(refreshToken || "").trim();

  if (!token) {
    throw new Error("refreshToken required");
  }

  const payload = verifyRefreshToken(token);

  const session = await AuthSessionModel.findOne({
    sid: payload.sid,
    userId: payload.sub,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  }).select("+refreshTokenHash");

  if (!session) {
    throw new Error("Invalid or expired session");
  }

  const ok = await bcrypt.compare(token, session.refreshTokenHash);

  if (!ok) {
    session.isRevoked = true;
    await session.save();
    throw new Error("Refresh token mismatch");
  }

  const newAccessToken = signAccessToken(payload.sub, payload.role, payload.sid);
  const newRefreshToken = signRefreshToken(payload.sub, payload.role, payload.sid);

  session.refreshTokenHash = await hashToken(newRefreshToken);
  session.lastUsedAt = new Date();
  await session.save();

  return {
    payload,
    session,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

export async function revokeSession(sid: string) {
  await AuthSessionModel.updateOne(
    { sid, isRevoked: false },
    { $set: { isRevoked: true, lastUsedAt: new Date() } }
  );
}

export async function revokeAllSessions(userId: string, userModel: AuthUserModel) {
  await AuthSessionModel.updateMany(
    { userId, userModel, isRevoked: false },
    { $set: { isRevoked: true, lastUsedAt: new Date() } }
  );
}

export async function revokeSessionByRefreshToken(refreshToken: string) {
  const token = String(refreshToken || "").trim();

  if (!token) {
    throw new Error("refreshToken required");
  }

  const payload = verifyRefreshToken(token);

  const session = await AuthSessionModel.findOne({
    sid: payload.sid,
    userId: payload.sub,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  }).select("+refreshTokenHash");

  if (!session) {
    throw new Error("Invalid or expired session");
  }

  const ok = await bcrypt.compare(token, session.refreshTokenHash);

  if (!ok) {
    session.isRevoked = true;
    await session.save();
    throw new Error("Refresh token mismatch");
  }

  session.isRevoked = true;
  session.lastUsedAt = new Date();
  await session.save();

  return {
    sid: session.sid,
    userId: String(session.userId),
    userModel: session.userModel,
    role: session.role,
  };
}