import { Router } from "express";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";

import {
  createSeries,
  listSeries,
  getSeries,
  updateSeries,
  deleteSeries,
  toggleSeriesActive,
} from "../controllers/series.controller";

const router = Router();

/* ===================== SERIES ===================== */

router.get("/", auth, listSeries);
router.get("/:id", auth, getSeries);

router.post(
  "/",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  createSeries
);

router.put(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  updateSeries
);

router.put(
  "/:id/active",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  toggleSeriesActive
);

router.delete(
  "/:id",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  deleteSeries
);

export default router;