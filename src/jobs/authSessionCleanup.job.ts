import cron from "node-cron";
import { AuthSessionModel } from "../models/authSession.model";
import { LoginAttemptModel } from "../models/loginAttempt.model";

const SESSION_CLEANUP_CRON = "0 * * * *"; // every hour

export function startAuthCleanupJob() {
  cron.schedule(SESSION_CLEANUP_CRON, async () => {
    try {
      const now = new Date();

      const expiredSessions = await AuthSessionModel.deleteMany({
        $or: [
          { expiresAt: { $lte: now } },
          {
            isRevoked: true,
            updatedAt: {
              $lte: new Date(
                now.getTime() - 7 * 24 * 60 * 60 * 1000
              ),
            },
          },
        ],
      });

      const staleAttempts = await LoginAttemptModel.deleteMany({
        updatedAt: {
          $lte: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        },
      });

      console.log(
        `[AuthCleanupJob] removed sessions=${expiredSessions.deletedCount || 0}, loginAttempts=${staleAttempts.deletedCount || 0}`
      );
    } catch (error) {
      console.error("[AuthCleanupJob] failed:", error);
    }
  });
}