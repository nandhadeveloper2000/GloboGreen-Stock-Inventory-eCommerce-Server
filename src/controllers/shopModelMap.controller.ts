import { Request, Response } from "express";
import { ShopModelMapModel } from "../models/shopModelMap.model";
import { ShopModel } from "../models/shop.model";
import { ModelModel } from "../models/model.model";
import { BrandModel } from "../models/brand.model";
import {
  type AuthRequest,
  type MongoError,
  buildCreatedBy,
  getErrorMessage,
  isObjectId,
  matchesSearch,
  norm,
} from "./shopMap.utils";

function buildShopModelMapQuery(query: any) {
  return query
    .populate("shopId", "name shopType isActive")
    .populate({
      path: "modelId",
      select: "name nameKey brandId isActive",
      populate: {
        path: "brandId",
        select: "name nameKey image isActive",
      },
    });
}

/**
 * CREATE SHOP MODEL MAP
 * POST /api/shop-model-maps
 */
export async function createShopModelMap(req: AuthRequest, res: Response) {
  try {
    const { shopId, modelId, isActive = true } = req.body as {
      shopId?: string;
      modelId?: string;
      isActive?: boolean;
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!isObjectId(modelId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid model id",
      });
    }

    const [shop, modelDoc] = await Promise.all([
      ShopModel.findById(shopId).select("_id name shopType isActive").lean(),
      ModelModel.findById(modelId)
        .select("_id brandId name nameKey isActive")
        .lean(),
    ]);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (!modelDoc) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    if (modelDoc.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Inactive model cannot be mapped",
      });
    }

    const brand = await BrandModel.findById(modelDoc.brandId)
      .select("_id name isActive")
      .lean();

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "Brand linked to this model was not found",
      });
    }

    if (brand.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Model belongs to an inactive brand",
      });
    }

    const existingMap = await ShopModelMapModel.findOne({
      shopId,
      modelId,
    })
      .select("_id isActive")
      .lean();

    if (existingMap) {
      return res.status(409).json({
        success: false,
        message: "This model is already mapped to this shop",
        data: existingMap,
      });
    }

    const created = await ShopModelMapModel.create({
      shopId,
      modelId,
      isActive: Boolean(isActive),
      createdBy: buildCreatedBy(req),
    });

    const data = await buildShopModelMapQuery(
      ShopModelMapModel.findById(created._id)
    ).lean();

    return res.status(201).json({
      success: true,
      message: "Shop model mapped successfully",
      data,
    });
  } catch (error) {
    console.error("createShopModelMap error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This model is already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop model"),
    });
  }
}

/**
 * BULK CREATE SHOP MODEL MAPS
 * POST /api/shop-model-maps/bulk
 */
export async function bulkCreateShopModelMaps(
  req: AuthRequest,
  res: Response
) {
  try {
    const { shopId, modelIds = [] } = req.body as {
      shopId?: string;
      modelIds?: string[];
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!Array.isArray(modelIds) || modelIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one model",
      });
    }

    const cleanModelIds = Array.from(
      new Set(modelIds.map((id) => String(id)).filter(isObjectId))
    );

    if (!cleanModelIds.length) {
      return res.status(400).json({
        success: false,
        message: "No valid model ids found",
      });
    }

    const shop = await ShopModel.findById(shopId)
      .select("_id name shopType isActive")
      .lean();

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    const models = await ModelModel.find({
      _id: { $in: cleanModelIds },
      isActive: true,
    })
      .select("_id brandId name nameKey isActive")
      .lean();

    if (!models.length) {
      return res.status(404).json({
        success: false,
        message: "No active models found",
      });
    }

    const activeBrands = await BrandModel.find({
      _id: { $in: models.map((row) => row.brandId) },
      isActive: true,
    })
      .select("_id")
      .lean();

    const activeBrandIds = new Set(
      activeBrands.map((brand) => String(brand._id))
    );

    const eligibleModels = models.filter((row) =>
      activeBrandIds.has(String(row.brandId))
    );

    if (!eligibleModels.length) {
      return res.status(404).json({
        success: false,
        message: "No active models with active brands found",
      });
    }

    const existingMaps = await ShopModelMapModel.find({
      shopId,
      modelId: { $in: eligibleModels.map((row) => row._id) },
    })
      .select("modelId")
      .lean();

    const existingModelIds = new Set(
      existingMaps.map((map) => String(map.modelId))
    );

    const newModels = eligibleModels.filter(
      (row) => !existingModelIds.has(String(row._id))
    );

    if (!newModels.length) {
      return res.status(409).json({
        success: false,
        message: "Selected models are already mapped to this shop",
        meta: {
          createdCount: 0,
          skippedCount: existingMaps.length,
        },
      });
    }

    const createdBy = buildCreatedBy(req);

    await ShopModelMapModel.insertMany(
      newModels.map((row) => ({
        shopId,
        modelId: row._id,
        isActive: true,
        createdBy,
      })),
      { ordered: false }
    );

    const data = await buildShopModelMapQuery(
      ShopModelMapModel.find({
        shopId,
        modelId: { $in: newModels.map((row) => row._id) },
      }).sort({ createdAt: -1 })
    ).lean();

    const createdCount = newModels.length;
    const skippedCount = existingMaps.length;

    return res.status(201).json({
      success: true,
      message:
        skippedCount > 0
          ? `${createdCount} model mapped successfully. ${skippedCount} already existed.`
          : "Shop models mapped successfully",
      data,
      meta: {
        createdCount,
        skippedCount,
      },
    });
  } catch (error) {
    console.error("bulkCreateShopModelMaps error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "One or more models are already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop models"),
    });
  }
}

/**
 * LIST ALL SHOP MODEL MAPS
 * GET /api/shop-model-maps
 */
export async function listShopModelMaps(req: Request, res: Response) {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const shopId = norm(req.query.shopId);
    const modelId = norm(req.query.modelId);
    const brandId = norm(req.query.brandId);
    const status = norm(req.query.status).toUpperCase();
    const search = norm(req.query.search);

    const filter: Record<string, unknown> = {};

    if (shopId) {
      if (!isObjectId(shopId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid shop id",
        });
      }

      filter.shopId = shopId;
    }

    if (modelId) {
      if (!isObjectId(modelId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid model id",
        });
      }

      filter.modelId = modelId;
    }

    if (status === "ACTIVE") filter.isActive = true;
    if (status === "INACTIVE") filter.isActive = false;

    let data = (await buildShopModelMapQuery(
      ShopModelMapModel.find(filter).sort({ createdAt: -1 })
    ).lean()) as any[];

    if (brandId) {
      if (!isObjectId(brandId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid brand id",
        });
      }

      data = data.filter((row) => {
        const rowBrandId = row.modelId?.brandId?._id || row.modelId?.brandId;
        return String(rowBrandId || "") === brandId;
      });
    }

    if (search) {
      data = data.filter((row) =>
        matchesSearch(
          [
            row.shopId?.name,
            row.shopId?.shopType,
            row.modelId?.name,
            row.modelId?.brandId?.name,
          ],
          search
        )
      );
    }

    const total = data.length;
    const paginated = data.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      message: "Shop model maps fetched successfully",
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("listShopModelMaps error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop model maps"),
    });
  }
}

/**
 * GET SINGLE SHOP MODEL MAP
 * GET /api/shop-model-maps/:id
 */
export async function getShopModelMapById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const data = await buildShopModelMapQuery(
      ShopModelMapModel.findById(id)
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop model map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop model map fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getShopModelMapById error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop model map"),
    });
  }
}

/**
 * GET MODELS BY SHOP
 * GET /api/shop-model-maps/shop/:shopId
 */
export async function listShopModelsByShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    const brandId = norm(req.query.brandId);
    const search = norm(req.query.search);

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    let data = (await buildShopModelMapQuery(
      ShopModelMapModel.find({
        shopId,
        isActive: true,
      }).sort({ createdAt: -1 })
    ).lean()) as any[];

    if (brandId) {
      if (!isObjectId(brandId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid brand id",
        });
      }

      data = data.filter((row) => {
        const rowBrandId = row.modelId?.brandId?._id || row.modelId?.brandId;
        return String(rowBrandId || "") === brandId;
      });
    }

    if (search) {
      data = data.filter((row) =>
        matchesSearch([row.modelId?.name, row.modelId?.brandId?.name], search)
      );
    }

    return res.status(200).json({
      success: true,
      message: "Shop models fetched successfully",
      data,
    });
  } catch (error) {
    console.error("listShopModelsByShop error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop models"),
    });
  }
}

/**
 * UPDATE MAP STATUS
 * PATCH /api/shop-model-maps/:id
 */
export async function updateShopModelMap(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { isActive } = req.body as {
      isActive?: boolean;
    };

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "No valid update field provided",
      });
    }

    const data = await buildShopModelMapQuery(
      ShopModelMapModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true, runValidators: true }
      )
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop model map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop model map updated successfully",
      data,
    });
  } catch (error) {
    console.error("updateShopModelMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to update shop model map"),
    });
  }
}

/**
 * TOGGLE STATUS
 * PATCH /api/shop-model-maps/:id/toggle-active
 */
export async function toggleShopModelMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const existing = await ShopModelMapModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Shop model map not found",
      });
    }

    existing.isActive = !existing.isActive;
    await existing.save();

    const data = await buildShopModelMapQuery(
      ShopModelMapModel.findById(id)
    ).lean();

    return res.status(200).json({
      success: true,
      message: existing.isActive
        ? "Shop model activated successfully"
        : "Shop model deactivated successfully",
      data,
    });
  } catch (error) {
    console.error("toggleShopModelMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to toggle shop model status"),
    });
  }
}

/**
 * DELETE MAP
 * DELETE /api/shop-model-maps/:id
 */
export async function deleteShopModelMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const deleted = await ShopModelMapModel.findByIdAndDelete(id).lean();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Shop model map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop model map deleted successfully",
    });
  } catch (error) {
    console.error("deleteShopModelMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to delete shop model map"),
    });
  }
}
