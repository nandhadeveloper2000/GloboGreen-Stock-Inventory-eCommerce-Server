import { Request, Response } from "express";
import bcrypt from "bcrypt";

import { AuthSessionModel } from "../models/authSession.model";
import { MasterModel } from "../models/master.model";
import { StaffModel } from "../models/staff.model";
import { ShopOwnerModel } from "../models/shopowner.model";
import { ShopStaffModel } from "../models/shopstaff.model";
import { CustomerModel } from "../models/customer.model";

import { verifyRefreshToken, type Role } from "../utils/jwt";
import {
  createLoginSession,
  revokeSession,
  revokeAllSessions,
  revokeSessionByRefreshToken,
  roleToUserModel,
} from "../utils/auth-session";

export type UserModelName =
  | "Master"
  | "Staff"
  | "ShopOwner"
  | "ShopStaff"
  | "Customer";

type JwtReqUser = {
  sid?: string;
  sub?: string;
  id?: string;
  role?: Role | string;
};

function safeUser(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;

  delete o.pinHash;
  delete o.passwordHash;
  delete o.pinResetOtp;
  delete o.pinResetOtpHash;
  delete o.pinResetOtpExpiresAt;
  delete o.pinResetAttempts;
  delete o.pinResetTokenHash;
  delete o.pinResetTokenExpiresAt;
  delete o.passwordResetOtp;
  delete o.passwordResetOtpHash;
  delete o.passwordResetOtpExpiresAt;
  delete o.passwordResetAttempts;
  delete o.passwordResetTokenHash;
  delete o.passwordResetTokenExpiresAt;
  delete o.verifyEmailOtp;
  delete o.verifyEmailOtpHash;
  delete o.verifyEmailOtpExpiresAt;
  delete o.loginOtp;
  delete o.loginOtpHash;
  delete o.loginOtpExpiresAt;
  delete o.otpHash;
  delete o.otpAttempts;
  delete o.otpExpiresAt;
  delete o.otpLastSentAt;
  delete o.refreshTokenHash;
  delete o.__v;

  return o;
}

export async function findUserByModel(userModel: UserModelName, id: string) {
  switch (userModel) {
    case "Master":
      return MasterModel.findById(id);

    case "Staff":
      return StaffModel.findById(id);

    case "ShopOwner":
      return ShopOwnerModel.findById(id);

    case "ShopStaff":
      return ShopStaffModel.findById(id);

    case "Customer":
      return CustomerModel.findById(id);

    default:
      return null;
  }
}

export async function refreshAuthSession(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body as {
      refreshToken?: string;
    };

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "refreshToken required",
      });
    }

    const payload = verifyRefreshToken(refreshToken);

    const session = await AuthSessionModel.findOne({
      sid: payload.sid,
      userId: payload.sub,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }).select("+refreshTokenHash");

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    const tokenMatch = await bcrypt.compare(
      refreshToken,
      session.refreshTokenHash
    );

    if (!tokenMatch) {
      session.isRevoked = true;
      await session.save();

      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    const user = await findUserByModel(
      session.userModel as UserModelName,
      String(payload.sub)
    );

    if (!user || (user as any).isActive === false) {
      session.isRevoked = true;
      await session.save();

      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { accessToken, refreshToken: newRefreshToken } =
      await createLoginSession({
        userId: String(payload.sub),
        role: payload.role,
        userModel: session.userModel as UserModelName,
        deviceName: session.deviceName,
        platform: session.platform,
        appVersion: session.appVersion,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      });

    session.isRevoked = true;
    await session.save();

    return res.json({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        role: payload.role,
        user: safeUser(user),
      },
    });
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
}

export async function logoutAuthSession(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtReqUser;

    if (!user?.sid) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    await revokeSession(user.sid);

    return res.json({
      success: true,
      message: "Logged out",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Logout failed",
    });
  }
}

export async function logoutAuthSessionByRefresh(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body as {
      refreshToken?: string;
    };

    if (!refreshToken || !String(refreshToken).trim()) {
      return res.status(400).json({
        success: false,
        message: "refreshToken required",
      });
    }

    await revokeSessionByRefreshToken(refreshToken);

    return res.json({
      success: true,
      message: "Logged out",
    });
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      message: err?.message || "Invalid or expired refresh token",
    });
  }
}

export async function logoutAllAuthSessions(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtReqUser;

    const userId = user?.sub || user?.id;
    const role = user?.role as Role | undefined;

    if (!userId || !role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userModel = roleToUserModel(role);

    await revokeAllSessions(String(userId), userModel);

    return res.json({
      success: true,
      message: "Logged out from all devices",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Logout all failed",
    });
  }
}

export async function getMyActiveSessions(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtReqUser;

    const userId = user?.sub || user?.id;
    const role = user?.role as Role | undefined;

    if (!userId || !role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userModel = roleToUserModel(role);

    const sessions = await AuthSessionModel.find({
      userId,
      userModel,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    })
      .select(
        "sid role deviceName platform appVersion ipAddress userAgent lastUsedAt expiresAt createdAt updatedAt"
      )
      .sort({ lastUsedAt: -1 });

    return res.json({
      success: true,
      data: sessions,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to fetch sessions",
    });
  }
}

export async function revokeSessionBySid(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtReqUser;

    const userId = user?.sub || user?.id;
    const role = user?.role as Role | undefined;
    const sid = String(req.params.sid || "").trim();

    if (!userId || !role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!sid) {
      return res.status(400).json({
        success: false,
        message: "sid required",
      });
    }

    const userModel = roleToUserModel(role);

    const session = await AuthSessionModel.findOne({
      sid,
      userId,
      userModel,
      isRevoked: false,
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    session.isRevoked = true;
    await session.save();

    return res.json({
      success: true,
      message: "Session revoked",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to revoke session",
    });
  }
}

export async function getMeFromSession(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtReqUser;

    const userId = user?.sub || user?.id;
    const role = user?.role as Role | undefined;

    if (!userId || !role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userModel = roleToUserModel(role);
    const doc = await findUserByModel(userModel as UserModelName, String(userId));

    if (!doc || (doc as any).isActive === false) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      data: {
        role,
        userModel,
        user: safeUser(doc),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to fetch current user",
    });
  }
}

/* helper exports used by other controllers */
export { createLoginSession };

export async function revokeAllUserSessions(userId: string, role: Role) {
  const userModel = roleToUserModel(role);
  return revokeAllSessions(String(userId), userModel);
}

export async function revokeCurrentSession(sid: string) {
  return revokeSession(sid);
}