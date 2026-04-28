import { Request, Response } from "express";
import mongoose from "mongoose";
import { VendorModel } from "../models/vendor.model";

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function makeVendorKey(value: unknown) {
  return norm(value).toLowerCase().replace(/\s+/g, " ");
}

function upper(value: unknown) {
  return norm(value).toUpperCase();
}

function parseAddress(
  addressInput: unknown,
  fallback: Record<string, unknown> = {}
) {
  const source =
    addressInput && typeof addressInput === "object"
      ? (addressInput as Record<string, unknown>)
      : {};

  return {
    state: norm(source.state ?? fallback.state),
    district: norm(source.district ?? fallback.district),
    taluk: norm(source.taluk ?? fallback.taluk),
    area: norm(source.area ?? fallback.area),
    street: norm(
      source.street ??
        (typeof addressInput === "string" ? addressInput : fallback.street)
    ),
    pincode: norm(source.pincode ?? fallback.pincode),
  };
}

function getUserId(req: Request) {
  return (
    (req as any).user?.sub ||
    (req as any).user?._id ||
    (req as any).user?.id
  );
}

function getUserRole(req: Request) {
  return String((req as any).user?.role || "").trim().toUpperCase();
}

function buildCreatedBy(req: Request) {
  const role = getUserRole(req);
  const userId = getUserId(req);

  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    throw new Error("Invalid user session");
  }

  if (role === "MASTER_ADMIN") {
    return {
      type: "MASTER",
      id: userId,
      role,
    };
  }

  if (role === "MANAGER") {
    return {
      type: "MANAGER",
      id: userId,
      role,
    };
  }

  if (role === "SHOP_OWNER") {
    return {
      type: "SHOP_OWNER",
      id: userId,
      role,
    };
  }

  return {
    type: "SHOP_STAFF",
    id: userId,
    role,
  };
}

function getShopIdFromReq(req: Request) {
  return norm(req.params?.shopId || req.query?.shopId || req.body?.shopId);
}

function isValidObjectId(id: string) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * GET /api/vendors?shopId=xxx&q=abc&status=ACTIVE
 * OR
 * GET /api/vendors/shop/:shopId
 */
export async function listVendors(req: Request, res: Response) {
  try {
    const shopId = getShopIdFromReq(req);

    if (!shopId || !isValidObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Valid shopId required",
      });
    }

    const q = norm(req.query?.q);
    const status = upper(req.query?.status);

    const filter: any = {
      shopId: new mongoose.Types.ObjectId(shopId),
    };

    if (status === "ACTIVE" || status === "INACTIVE") {
      filter.status = status;
    }

    if (q) {
      const qRegex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

      filter.$or = [
        { code: qRegex },
        { vendorName: qRegex },
        { vendorKey: qRegex },
        { contactPerson: qRegex },
        { email: qRegex },
        { mobile: qRegex },
        { gstNumber: qRegex },
        { gstState: qRegex },
        { "address.state": qRegex },
        { "address.district": qRegex },
        { "address.taluk": qRegex },
        { "address.area": qRegex },
        { "address.street": qRegex },
        { "address.pincode": qRegex },
      ];
    }

    const rows = await VendorModel.find(filter)
      .select(
        "_id shopId code vendorName vendorKey contactPerson email mobile gstNumber gstState address notes status createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list vendors",
    });
  }
}

/**
 * POST /api/vendors
 *
 * Body:
 * {
 *   "shopId": "...",
 *   "code": "NANSUP8792",
 *   "vendorName": "Nandhakumar S",
 *   "contactPerson": "Nandhakumar S",
 *   "email": "...",
 *   "mobile": "...",
 *   "gstNumber": "33ABCDE1234F1Z5",
 *   "gstState": "33 – Tamil Nadu",
 *   "address": {
 *     "state": "Tamil Nadu",
 *     "district": "Cuddalore",
 *     "taluk": "Cuddalore",
 *     "area": "Cuddalore O.T (NM)",
 *     "street": "1, Sathiya Salai",
 *     "pincode": "608501"
 *   },
 *   "notes": "",
 *   "status": "ACTIVE"
 * }
 */
export async function createVendor(req: Request, res: Response) {
  try {
    const shopId = getShopIdFromReq(req);
    const code = upper(req.body?.code);
    const vendorName = norm(req.body?.vendorName);
    const contactPerson = norm(req.body?.contactPerson);
    const email = norm(req.body?.email).toLowerCase();
    const mobile = norm(req.body?.mobile);
    const gstNumber = upper(req.body?.gstNumber);
    const gstState = norm(req.body?.gstState);
    const address = parseAddress(req.body?.address, req.body || {});
    const notes = norm(req.body?.notes);
    const status = upper(req.body?.status) || "ACTIVE";

    if (!shopId || !isValidObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Valid shopId required",
      });
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Vendor code required",
      });
    }

    if (!vendorName) {
      return res.status(400).json({
        success: false,
        message: "Vendor name required",
      });
    }

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    if (gstNumber && !gstState) {
      return res.status(400).json({
        success: false,
        message: "GST state required when GST number is entered",
      });
    }

    const vendorKey = makeVendorKey(vendorName);

    const doc = await VendorModel.create({
      shopId,
      code,
      vendorName,
      vendorKey,
      contactPerson,
      email,
      mobile,
      gstNumber,
      gstState,
      address,
      notes,
      status,
      createdBy: buildCreatedBy(req),
    });

    return res.status(201).json({
      success: true,
      message: "Vendor created successfully",
      data: doc,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      const keyPattern = error?.keyPattern || {};

      let message = "Vendor already exists";

      if (keyPattern?.code) {
        message = "Vendor code already exists for this shop";
      }

      if (keyPattern?.vendorKey) {
        message = "Vendor name already exists for this shop";
      }

      return res.status(409).json({
        success: false,
        message,
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create vendor",
    });
  }
}

/**
 * GET /api/vendors/:id
 */
export async function getVendorById(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Valid vendor id required",
      });
    }

    const doc = await VendorModel.findById(id).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get vendor",
    });
  }
}

/**
 * PUT /api/vendors/:id
 */
export async function updateVendor(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Valid vendor id required",
      });
    }

    const existing = await VendorModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    const code = upper(req.body?.code);
    const vendorName = norm(req.body?.vendorName);
    const status = upper(req.body?.status);
    const gstNumber = upper(req.body?.gstNumber);
    const gstState = norm(req.body?.gstState);

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Vendor code required",
      });
    }

    if (!vendorName) {
      return res.status(400).json({
        success: false,
        message: "Vendor name required",
      });
    }

    if (status && !["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    if (gstNumber && !gstState) {
      return res.status(400).json({
        success: false,
        message: "GST state required when GST number is entered",
      });
    }

    existing.code = code;
    existing.vendorName = vendorName;
    existing.vendorKey = makeVendorKey(vendorName);
    existing.contactPerson = norm(req.body?.contactPerson);
    existing.email = norm(req.body?.email).toLowerCase();
    existing.mobile = norm(req.body?.mobile);
    existing.gstNumber = gstNumber;
    existing.gstState = gstState;
    existing.address = parseAddress(req.body?.address, req.body || {});
    existing.notes = norm(req.body?.notes);

    if (status) {
      existing.status = status;
    }

    await existing.save();

    return res.json({
      success: true,
      message: "Vendor updated successfully",
      data: existing,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      const keyPattern = error?.keyPattern || {};

      let message = "Vendor already exists";

      if (keyPattern?.code) {
        message = "Vendor code already exists for this shop";
      }

      if (keyPattern?.vendorKey) {
        message = "Vendor name already exists for this shop";
      }

      return res.status(409).json({
        success: false,
        message,
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update vendor",
    });
  }
}

/**
 * PATCH /api/vendors/:id/status
 * Body: { status: "ACTIVE" | "INACTIVE" }
 */
export async function updateVendorStatus(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);
    const status = upper(req.body?.status);

    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Valid vendor id required",
      });
    }

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const doc = await VendorModel.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.json({
      success: true,
      message: "Vendor status updated successfully",
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update vendor status",
    });
  }
}

/**
 * DELETE /api/vendors/:id
 * Soft delete = status INACTIVE
 */
export async function deleteVendor(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Valid vendor id required",
      });
    }

    const doc = await VendorModel.findByIdAndUpdate(
      id,
      { $set: { status: "INACTIVE" } },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.json({
      success: true,
      message: "Vendor deactivated successfully",
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete vendor",
    });
  }
}