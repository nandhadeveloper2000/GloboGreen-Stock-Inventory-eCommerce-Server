import { Router } from "express";
import { auth } from "../middlewares/auth";

import {
  refreshAuthSession,
  logoutAuthSession,
  logoutAuthSessionByRefresh,
  logoutAllAuthSessions,
  getMyActiveSessions,
  revokeSessionBySid,
  getMeFromSession,
} from "../controllers/auth.controller";
import { refreshRateLimiter } from "../middlewares/rateLimit.middleware";

const router = Router();

/* ===================== PUBLIC ===================== */
router.post("/refresh", refreshRateLimiter, refreshAuthSession);
router.post("/logout-by-refresh", refreshRateLimiter, logoutAuthSessionByRefresh);

/* ===================== AUTH REQUIRED ===================== */
router.post("/logout", auth, logoutAuthSession);
router.post("/logout-all", auth, logoutAllAuthSessions);
router.get("/me", auth, getMeFromSession);
router.get("/sessions", auth, getMyActiveSessions);
router.delete("/sessions/:sid", auth, revokeSessionBySid);

export default router;