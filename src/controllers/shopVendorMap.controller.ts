import { Request, Response } from "express";
import mongoose from "mongoose";
import { VendorModel } from "../models/vendor.model";
import { ShopVendorMapModel } from "../models/shopVendorMap.model";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));
const norm = (v: any) => String(v ?? "").trim();

function buildAddedBy(user: any) {
  // NOTE: Your schema allows only shop roles here, so CREATE_ROLES must match.
  return { type: user.role, id: user.sub, role: user.role };
}

/** ✅ ADD (attach) vendor to shop (mapping) */
export async function addVendorToShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    const { vendorId } = req.body as any;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(vendorId)) return res.status(400).json({ success: false, message: "Invalid vendorId" });

    const vendor = await VendorModel.findById(vendorId);
    if (!vendor || !vendor.isActiveGlobal) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    const payload = {
      mobile: norm(req.body?.mobile),
      email: norm(req.body?.email),
      gstNo: norm(req.body?.gstNo),
      address: req.body?.address ?? {},

      creditLimit: Number(req.body?.creditLimit ?? 0),
      openingBalance: Number(req.body?.openingBalance ?? 0),
      note: norm(req.body?.note),
    };

    const map = await ShopVendorMapModel.findOneAndUpdate(
      { shopId, vendorId },
      {
        $setOnInsert: { shopId, vendorId, addedBy: buildAddedBy((req as any).user) },
        $set: { ...payload, isActive: true },
      },
      { upsert: true, new: true }
    ).populate("vendorId", "vendorName");

    return res.json({ success: true, data: map });
  } catch (e: any) {
    if (e?.code === 11000) {
      return res.status(409).json({ success: false, message: "Vendor already added to this shop" });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ UPDATE mapping (shop-specific vendor info) */
export async function updateShopVendor(req: Request, res: Response) {
  try {
    const { shopId, vendorId } = req.params;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(vendorId)) return res.status(400).json({ success: false, message: "Invalid vendorId" });

    const patch: any = {};
    if ("mobile" in req.body) patch.mobile = norm(req.body.mobile);
    if ("email" in req.body) patch.email = norm(req.body.email);
    if ("gstNo" in req.body) patch.gstNo = norm(req.body.gstNo);
    if ("address" in req.body) patch.address = req.body.address ?? {};
    if ("creditLimit" in req.body) patch.creditLimit = Number(req.body.creditLimit ?? 0);
    if ("openingBalance" in req.body) patch.openingBalance = Number(req.body.openingBalance ?? 0);
    if ("note" in req.body) patch.note = norm(req.body.note);

    const updated = await ShopVendorMapModel.findOneAndUpdate(
      { shopId, vendorId, isActive: true },
      { $set: patch },
      { new: true }
    ).populate("vendorId", "vendorName");

    if (!updated) return res.status(404).json({ success: false, message: "Shop vendor mapping not found" });

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ LIST shop vendors */
export async function listShopVendors(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });

    const rows = await ShopVendorMapModel.find({ shopId, isActive: true })
      .populate("vendorId", "vendorName")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ DEACTIVATE (soft delete) mapping */
export async function deactivateShopVendor(req: Request, res: Response) {
  try {
    const { shopId, vendorId } = req.params;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(vendorId)) return res.status(400).json({ success: false, message: "Invalid vendorId" });

    const updated = await ShopVendorMapModel.findOneAndUpdate(
      { shopId, vendorId },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, message: "Mapping not found" });

    return res.json({ success: true, message: "Vendor removed from shop", data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}