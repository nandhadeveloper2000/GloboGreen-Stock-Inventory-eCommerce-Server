import { Request, Response } from "express";
import { VendorModel } from "../models/vendor.model";

const norm = (v: any) => String(v ?? "").trim();

function buildCreatedBy(user: any) {
  if (user.role === "MASTER_ADMIN") return { type: "MASTER", id: user.sub, role: user.role };
  if (user.role === "MANAGER") return { type: "MANAGER", id: user.sub, role: user.role };
  if (user.role === "SHOP_OWNER") return { type: "SHOP_OWNER", id: user.sub, role: user.role };
  return { type: "SHOP_STAFF", id: user.sub, role: user.role };
}

/** ✅ LIST GLOBAL VENDORS (search) */
export async function listGlobalVendors(req: Request, res: Response) {
  try {
    const q = String(req.query?.q ?? "").trim().toLowerCase();

    const filter: any = { isActiveGlobal: true };
    if (q) filter.vendorKey = { $regex: q, $options: "i" };

    const rows = await VendorModel.find(filter).sort({ vendorKey: 1 }).limit(100);
    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ CREATE GLOBAL VENDOR (upsert by vendorKey) */
export async function createGlobalVendor(req: Request, res: Response) {
  try {
    const vendorName = norm(req.body?.vendorName);
    if (!vendorName) return res.status(400).json({ success: false, message: "vendorName required" });

    const doc = await VendorModel.findOneAndUpdate(
      { vendorKey: vendorName.toLowerCase() },
      { $setOnInsert: { vendorName, createdBy: buildCreatedBy((req as any).user) } },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: doc });
  } catch (e: any) {
    if (e?.code === 11000) {
      return res.status(409).json({ success: false, message: "Vendor already exists" });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
}