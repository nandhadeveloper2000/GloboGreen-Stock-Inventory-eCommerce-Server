import { Router } from "express";
import {
  getStates,
  getDistricts,
  getTaluks,
  getVillages,
  getLocations,
} from "../controllers/location.controller";

const router = Router();

router.get("/all", getLocations);
router.get("/states", getStates);
router.get("/districts", getDistricts);
router.get("/taluks", getTaluks);
router.get("/villages", getVillages);

export default router;