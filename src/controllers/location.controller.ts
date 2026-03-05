import type { Request, Response } from "express";
import mongoose from "mongoose";

type LocationDoc = {
  _id?: any;
  sno?: number;
  state?: string;
  district?: string;
  talukName?: string;
  villageName?: string;
};

const DEFAULT_STATE = "Tamil Nadu";

/** Helper to get native Mongo collection (same as your old code) */
const Locations = () => mongoose.connection.db.collection<LocationDoc>("locations");

/**
 * GET /api/locations/states
 * -> ["Tamil Nadu", "Puducherry", ...]
 */
export const getStates = async (req: Request, res: Response) => {
  try {
    const states = await Locations().distinct("state", {});
    return res.json({
      success: true,
      data: (states as string[]).filter(Boolean).sort(),
    });
  } catch (err) {
    console.error("getStates error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch states" });
  }
};

/**
 * GET /api/locations/districts?state=Tamil%20Nadu
 * -> ["Cuddalore", "Chennai", ...]
 */
export const getDistricts = async (req: Request, res: Response) => {
  try {
    const state = String(req.query.state || "").trim();
    const stateFilter = state || DEFAULT_STATE;

    const districts = await Locations().distinct("district", { state: stateFilter });

    return res.json({
      success: true,
      data: (districts as string[]).filter(Boolean).sort(),
    });
  } catch (err) {
    console.error("getDistricts error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch districts" });
  }
};

/**
 * GET /api/locations/taluks?state=Tamil%20Nadu&district=Cuddalore
 * -> ["Kurinjipadi", "Panruti", ...]
 */
export const getTaluks = async (req: Request, res: Response) => {
  try {
    const state = String(req.query.state || "").trim();
    const district = String(req.query.district || "").trim();

    if (!district) {
      return res.status(400).json({ success: false, message: "district query is required" });
    }

    const stateFilter = state || DEFAULT_STATE;

    const taluks = await Locations().distinct("talukName", { state: stateFilter, district });

    return res.json({
      success: true,
      data: (taluks as string[]).filter(Boolean).sort(),
    });
  } catch (err) {
    console.error("getTaluks error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch taluks" });
  }
};

/**
 * GET /api/locations/villages?state=Tamil%20Nadu&district=Cuddalore&talukName=Kurinjipadi
 * -> ["Vadavandankuppam", ...]
 */
export const getVillages = async (req: Request, res: Response) => {
  try {
    const state = String(req.query.state || "").trim();
    const district = String(req.query.district || "").trim();
    const talukName = String(req.query.talukName || "").trim();

    if (!district || !talukName) {
      return res
        .status(400)
        .json({ success: false, message: "district and talukName are required" });
    }

    const stateFilter = state || DEFAULT_STATE;

    const docs = await Locations()
      .find({ state: stateFilter, district, talukName })
      .project({ villageName: 1, sno: 1, _id: 0 })
      .sort({ sno: 1 })
      .toArray();

    const villages = docs.map((v) => v.villageName).filter(Boolean) as string[];

    return res.json({ success: true, data: villages });
  } catch (err) {
    console.error("getVillages error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch villages" });
  }
};

/**
 * OPTIONAL: GET /api/locations/all?state=...&district=...&talukName=...
 * Returns full rows if you ever need them.
 */
export const getLocations = async (req: Request, res: Response) => {
  try {
    const state = String(req.query.state || "").trim();
    const district = String(req.query.district || "").trim();
    const talukName = String(req.query.talukName || "").trim();

    const filter: Record<string, any> = {};
    if (state) filter.state = state;
    if (district) filter.district = district;
    if (talukName) filter.talukName = talukName;

    const rows = await Locations().find(filter).sort({ sno: 1 }).toArray();

    return res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getLocations error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch locations" });
  }
};