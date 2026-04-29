import { Request, Response } from "express";
import { ShopBrandMapModel } from "../models/shopBrandMap.model";
import { ShopModel } from "../models/shop.model";
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

function buildShopBrandMapQuery(query: any) {
  return query
    .populate("shopId", "name shopType isActive")
    .populate("brandId", "name nameKey image isActive");
}

/**
 * CREATE SHOP BRAND MAP
 * POST /api/shop-brand-maps
 */
export async function createShopBrandMap(req: AuthRequest, res: Response) {
  try {
    const { shopId, brandId, isActive = true } = req.body as {
      shopId?: string;
      brandId?: string;
      isActive?: boolean;
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!isObjectId(brandId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid brand id",
      });
    }

    const [shop, brand] = await Promise.all([
      ShopModel.findById(shopId).select("_id name shopType isActive").lean(),
      BrandModel.findById(brandId).select("_id name image isActive").lean(),
    ]);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    if (brand.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Inactive brand cannot be mapped",
      });
    }

    const existingMap = await ShopBrandMapModel.findOne({
      shopId,
      brandId,
    })
      .select("_id isActive")
      .lean();

    if (existingMap) {
      return res.status(409).json({
        success: false,
        message: "This brand is already mapped to this shop",
        data: existingMap,
      });
    }

    const created = await ShopBrandMapModel.create({
      shopId,
      brandId,
      isActive: Boolean(isActive),
      createdBy: buildCreatedBy(req),
    });

    const data = await buildShopBrandMapQuery(
      ShopBrandMapModel.findById(created._id)
    ).lean();

    return res.status(201).json({
      success: true,
      message: "Shop brand mapped successfully",
      data,
    });
  } catch (error) {
    console.error("createShopBrandMap error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This brand is already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop brand"),
    });
  }
}

/**
 * BULK CREATE SHOP BRAND MAPS
 * POST /api/shop-brand-maps/bulk
 */
export async function bulkCreateShopBrandMaps(
  req: AuthRequest,
  res: Response
) {
  try {
    const { shopId, brandIds = [] } = req.body as {
      shopId?: string;
      brandIds?: string[];
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!Array.isArray(brandIds) || brandIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one brand",
      });
    }

    const cleanBrandIds = Array.from(
      new Set(brandIds.map((id) => String(id)).filter(isObjectId))
    );

    if (!cleanBrandIds.length) {
      return res.status(400).json({
        success: false,
        message: "No valid brand ids found",
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

    const brands = await BrandModel.find({
      _id: { $in: cleanBrandIds },
      isActive: true,
    })
      .select("_id name image isActive")
      .lean();

    if (!brands.length) {
      return res.status(404).json({
        success: false,
        message: "No active brands found",
      });
    }

    const existingMaps = await ShopBrandMapModel.find({
      shopId,
      brandId: { $in: brands.map((brand) => brand._id) },
    })
      .select("brandId")
      .lean();

    const existingBrandIds = new Set(
      existingMaps.map((map) => String(map.brandId))
    );

    const newBrands = brands.filter(
      (brand) => !existingBrandIds.has(String(brand._id))
    );

    if (!newBrands.length) {
      return res.status(409).json({
        success: false,
        message: "Selected brands are already mapped to this shop",
        meta: {
          createdCount: 0,
          skippedCount: existingMaps.length,
        },
      });
    }

    const createdBy = buildCreatedBy(req);

    await ShopBrandMapModel.insertMany(
      newBrands.map((brand) => ({
        shopId,
        brandId: brand._id,
        isActive: true,
        createdBy,
      })),
      { ordered: false }
    );

    const data = await buildShopBrandMapQuery(
      ShopBrandMapModel.find({
        shopId,
        brandId: { $in: newBrands.map((brand) => brand._id) },
      }).sort({ createdAt: -1 })
    ).lean();

    const createdCount = newBrands.length;
    const skippedCount = existingMaps.length;

    return res.status(201).json({
      success: true,
      message:
        skippedCount > 0
          ? `${createdCount} brand mapped successfully. ${skippedCount} already existed.`
          : "Shop brands mapped successfully",
      data,
      meta: {
        createdCount,
        skippedCount,
      },
    });
  } catch (error) {
    console.error("bulkCreateShopBrandMaps error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "One or more brands are already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop brands"),
    });
  }
}

/**
 * LIST ALL SHOP BRAND MAPS
 * GET /api/shop-brand-maps
 */
export async function listShopBrandMaps(req: Request, res: Response) {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const shopId = norm(req.query.shopId);
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

    if (brandId) {
      if (!isObjectId(brandId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid brand id",
        });
      }

      filter.brandId = brandId;
    }

    if (status === "ACTIVE") filter.isActive = true;
    if (status === "INACTIVE") filter.isActive = false;

    let data = (await buildShopBrandMapQuery(
      ShopBrandMapModel.find(filter).sort({ createdAt: -1 })
    ).lean()) as any[];

    if (search) {
      data = data.filter((row) =>
        matchesSearch(
          [row.shopId?.name, row.shopId?.shopType, row.brandId?.name],
          search
        )
      );
    }

    const total = data.length;
    const paginated = data.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      message: "Shop brand maps fetched successfully",
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("listShopBrandMaps error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop brand maps"),
    });
  }
}

/**
 * GET SINGLE SHOP BRAND MAP
 * GET /api/shop-brand-maps/:id
 */
export async function getShopBrandMapById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const data = await buildShopBrandMapQuery(
      ShopBrandMapModel.findById(id)
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop brand map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop brand map fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getShopBrandMapById error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop brand map"),
    });
  }
}

/**
 * GET BRANDS BY SHOP
 * GET /api/shop-brand-maps/shop/:shopId
 */
export async function listShopBrandsByShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    const search = norm(req.query.search);

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    let data = (await buildShopBrandMapQuery(
      ShopBrandMapModel.find({
        shopId,
        isActive: true,
      }).sort({ createdAt: -1 })
    ).lean()) as any[];

    if (search) {
      data = data.filter((row) =>
        matchesSearch([row.brandId?.name, row.brandId?.nameKey], search)
      );
    }

    return res.status(200).json({
      success: true,
      message: "Shop brands fetched successfully",
      data,
    });
  } catch (error) {
    console.error("listShopBrandsByShop error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop brands"),
    });
  }
}

/**
 * UPDATE MAP STATUS
 * PATCH /api/shop-brand-maps/:id
 */
export async function updateShopBrandMap(req: Request, res: Response) {
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

    const data = await buildShopBrandMapQuery(
      ShopBrandMapModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true, runValidators: true }
      )
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop brand map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop brand map updated successfully",
      data,
    });
  } catch (error) {
    console.error("updateShopBrandMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to update shop brand map"),
    });
  }
}

/**
 * TOGGLE STATUS
 * PATCH /api/shop-brand-maps/:id/toggle-active
 */
export async function toggleShopBrandMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const existing = await ShopBrandMapModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Shop brand map not found",
      });
    }

    existing.isActive = !existing.isActive;
    await existing.save();

    const data = await buildShopBrandMapQuery(
      ShopBrandMapModel.findById(id)
    ).lean();

    return res.status(200).json({
      success: true,
      message: existing.isActive
        ? "Shop brand activated successfully"
        : "Shop brand deactivated successfully",
      data,
    });
  } catch (error) {
    console.error("toggleShopBrandMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to toggle shop brand status"),
    });
  }
}

/**
 * DELETE MAP
 * DELETE /api/shop-brand-maps/:id
 */
export async function deleteShopBrandMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const deleted = await ShopBrandMapModel.findByIdAndDelete(id).lean();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Shop brand map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop brand map deleted successfully",
    });
  } catch (error) {
    console.error("deleteShopBrandMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to delete shop brand map"),
    });
  }
}
