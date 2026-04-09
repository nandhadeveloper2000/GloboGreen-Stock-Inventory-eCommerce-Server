import { Request, Response } from "express";
import mongoose from "mongoose";

import { SeriesModel } from "../models/series.model";
import { BrandModel } from "../models/brand.model";
import { ModelModel } from "../models/model.model";

type AuthRole = "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR" | "STAFF";

type AuthUser = {
  sub?: string;
  role?: AuthRole;
};

const isObjectId = (id: unknown): boolean =>
  mongoose.Types.ObjectId.isValid(String(id));

const norm = (value: unknown): string => String(value ?? "").trim();

const keyOf = (value: unknown): string => norm(value).toLowerCase();

function getAuthUser(req: Request): AuthUser | undefined {
  return (req as any).user as AuthUser | undefined;
}

function buildCreatedBy(user?: AuthUser) {
  if (!user?.sub || !user?.role) {
    return {
      type: "SYSTEM",
      id: null,
      role: "STAFF",
    };
  }

  switch (user.role) {
    case "MASTER_ADMIN":
      return { type: "MASTER", id: user.sub, role: user.role };
    case "MANAGER":
      return { type: "MANAGER", id: user.sub, role: user.role };
    case "SUPERVISOR":
      return { type: "SUPERVISOR", id: user.sub, role: user.role };
    case "STAFF":
      return { type: "STAFF", id: user.sub, role: user.role };
    default:
      return {
        type: "SYSTEM",
        id: null,
        role: "STAFF",
      };
  }
}

/* ========================================================================== */
/*                                CREATE SERIES                               */
/* ========================================================================== */
export async function createSeries(req: Request, res: Response) {
  try {
    const brandId = norm(req.body?.brandId);
    const name = norm(req.body?.name);

    if (!brandId) {
      return res.status(400).json({
        success: false,
        message: "brandId is required",
      });
    }

    if (!isObjectId(brandId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid brandId",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required",
      });
    }

    const brand = await BrandModel.findById(brandId).lean();
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    const nameKey = keyOf(name);

    const exists = await SeriesModel.findOne({
      brandId,
      nameKey,
    }).lean();

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Series already exists under this Brand",
      });
    }

    const doc = await SeriesModel.create({
      brandId,
      name,
      nameKey,
      isActive: true,
      createdBy: buildCreatedBy(getAuthUser(req)),
    });

    const populated = await SeriesModel.findById(doc._id).populate(
      "brandId",
      "name nameKey isActive"
    );

    return res.status(201).json({
      success: true,
      message: "Series created successfully",
      data: populated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Series already exists under this Brand",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create Series",
    });
  }
}

/* ========================================================================== */
/*                                 LIST SERIES                                */
/* ========================================================================== */
export async function listSeries(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q);
    const brandId = norm(req.query?.brandId);
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (q) {
      filter.nameKey = { $regex: keyOf(q), $options: "i" };
    }

    if (brandId) {
      if (!isObjectId(brandId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid brandId",
        });
      }

      filter.brandId = brandId;
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    const rows = await SeriesModel.find(filter)
      .populate("brandId", "name nameKey isActive")
      .sort({ nameKey: 1 })
      .limit(500);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Series",
    });
  }
}

/* ========================================================================== */
/*                                  GET SERIES                                */
/* ========================================================================== */
export async function getSeries(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await SeriesModel.findById(id).populate(
      "brandId",
      "name nameKey isActive"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Series not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Series",
    });
  }
}

/* ========================================================================== */
/*                                UPDATE SERIES                               */
/* ========================================================================== */
export async function updateSeries(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    const brandId = norm(req.body?.brandId);
    const name = norm(req.body?.name);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await SeriesModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Series not found",
      });
    }

    const updateData: Record<string, any> = {};

    const nextBrandId = brandId || String(current.brandId);
    const nextName = name || current.name;
    const nextNameKey = keyOf(nextName);

    if (brandId) {
      if (!isObjectId(brandId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid brandId",
        });
      }

      const brand = await BrandModel.findById(brandId).lean();
      if (!brand) {
        return res.status(404).json({
          success: false,
          message: "Brand not found",
        });
      }

      updateData.brandId = brandId;
    }

    if (name) {
      updateData.name = name;
      updateData.nameKey = nextNameKey;
    }

    const duplicate = await SeriesModel.findOne({
      _id: { $ne: id },
      brandId: nextBrandId,
      nameKey: nextNameKey,
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Series already exists under this Brand",
      });
    }

    const updated = await SeriesModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("brandId", "name nameKey isActive");

    return res.json({
      success: true,
      message: "Series updated successfully",
      data: updated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Series already exists under this Brand",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Series",
    });
  }
}

/* ========================================================================== */
/*                                DELETE SERIES                               */
/* ========================================================================== */
export async function deleteSeries(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const linkedModel = await ModelModel.findOne({
      seriesId: id,
    }).lean();

    if (linkedModel) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete Series. Models exist under it",
      });
    }

    const current = await SeriesModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Series not found",
      });
    }

    await SeriesModel.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: "Series deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete Series",
    });
  }
}

/* ========================================================================== */
/*                             TOGGLE SERIES ACTIVE                           */
/* ========================================================================== */
export async function toggleSeriesActive(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    if (typeof req.body?.isActive === "undefined") {
      return res.status(400).json({
        success: false,
        message: "isActive is required",
      });
    }

    const isActive = String(req.body.isActive) === "true";

    const updated = await SeriesModel.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).populate("brandId", "name nameKey isActive");

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Series not found",
      });
    }

    return res.json({
      success: true,
      message: `Series ${isActive ? "activated" : "deactivated"} successfully`,
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Series status",
    });
  }
}