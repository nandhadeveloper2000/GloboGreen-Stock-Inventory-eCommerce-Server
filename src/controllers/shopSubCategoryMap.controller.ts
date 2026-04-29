import { Request, Response } from "express";
import { ShopSubCategoryMapModel } from "../models/shopSubCategoryMap.model";
import { ShopModel } from "../models/shop.model";
import { SubCategoryModel } from "../models/subcategory.model";
import {
  type AuthRequest,
  type MongoError,
  buildCreatedBy,
  getErrorMessage,
  isObjectId,
  matchesSearch,
  norm,
} from "./shopMap.utils";

function buildShopSubCategoryMapQuery(query: any) {
  return query
    .populate("shopId", "name shopType isActive")
    .populate({
      path: "subCategoryId",
      select: "name image categoryId isActive",
      populate: {
        path: "categoryId",
        select: "name image masterCategoryId isActive",
        populate: {
          path: "masterCategoryId",
          select: "name image isActive",
        },
      },
    });
}

/**
 * CREATE SHOP SUB CATEGORY MAP
 * POST /api/shop-sub-category-maps
 */
export async function createShopSubCategoryMap(
  req: AuthRequest,
  res: Response
) {
  try {
    const { shopId, subCategoryId, isActive = true } = req.body as {
      shopId?: string;
      subCategoryId?: string;
      isActive?: boolean;
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!isObjectId(subCategoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subcategory id",
      });
    }

    const [shop, subCategory] = await Promise.all([
      ShopModel.findById(shopId).select("_id name shopType isActive").lean(),
      SubCategoryModel.findById(subCategoryId)
        .select("_id categoryId name image isActive")
        .lean(),
    ]);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (!subCategory) {
      return res.status(404).json({
        success: false,
        message: "Subcategory not found",
      });
    }

    if (subCategory.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Inactive subcategory cannot be mapped",
      });
    }

    const existingMap = await ShopSubCategoryMapModel.findOne({
      shopId,
      subCategoryId,
    })
      .select("_id isActive")
      .lean();

    if (existingMap) {
      return res.status(409).json({
        success: false,
        message: "This subcategory is already mapped to this shop",
        data: existingMap,
      });
    }

    const created = await ShopSubCategoryMapModel.create({
      shopId,
      subCategoryId,
      isActive: Boolean(isActive),
      createdBy: buildCreatedBy(req),
    });

    const data = await buildShopSubCategoryMapQuery(
      ShopSubCategoryMapModel.findById(created._id)
    ).lean();

    return res.status(201).json({
      success: true,
      message: "Shop subcategory mapped successfully",
      data,
    });
  } catch (error) {
    console.error("createShopSubCategoryMap error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This subcategory is already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop subcategory"),
    });
  }
}

/**
 * BULK CREATE SHOP SUB CATEGORY MAPS
 * POST /api/shop-sub-category-maps/bulk
 */
export async function bulkCreateShopSubCategoryMaps(
  req: AuthRequest,
  res: Response
) {
  try {
    const { shopId, subCategoryIds = [] } = req.body as {
      shopId?: string;
      subCategoryIds?: string[];
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!Array.isArray(subCategoryIds) || subCategoryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one subcategory",
      });
    }

    const cleanSubCategoryIds = Array.from(
      new Set(subCategoryIds.map((id) => String(id)).filter(isObjectId))
    );

    if (!cleanSubCategoryIds.length) {
      return res.status(400).json({
        success: false,
        message: "No valid subcategory ids found",
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

    const subCategories = await SubCategoryModel.find({
      _id: { $in: cleanSubCategoryIds },
      isActive: true,
    })
      .select("_id categoryId name image isActive")
      .lean();

    if (!subCategories.length) {
      return res.status(404).json({
        success: false,
        message: "No active subcategories found",
      });
    }

    const existingMaps = await ShopSubCategoryMapModel.find({
      shopId,
      subCategoryId: { $in: subCategories.map((subCategory) => subCategory._id) },
    })
      .select("subCategoryId")
      .lean();

    const existingSubCategoryIds = new Set(
      existingMaps.map((map) => String(map.subCategoryId))
    );

    const newSubCategories = subCategories.filter(
      (subCategory) => !existingSubCategoryIds.has(String(subCategory._id))
    );

    if (!newSubCategories.length) {
      return res.status(409).json({
        success: false,
        message: "Selected subcategories are already mapped to this shop",
        meta: {
          createdCount: 0,
          skippedCount: existingMaps.length,
        },
      });
    }

    const createdBy = buildCreatedBy(req);

    await ShopSubCategoryMapModel.insertMany(
      newSubCategories.map((subCategory) => ({
        shopId,
        subCategoryId: subCategory._id,
        isActive: true,
        createdBy,
      })),
      { ordered: false }
    );

    const data = await buildShopSubCategoryMapQuery(
      ShopSubCategoryMapModel.find({
        shopId,
        subCategoryId: { $in: newSubCategories.map((subCategory) => subCategory._id) },
      }).sort({ createdAt: -1 })
    ).lean();

    const createdCount = newSubCategories.length;
    const skippedCount = existingMaps.length;

    return res.status(201).json({
      success: true,
      message:
        skippedCount > 0
          ? `${createdCount} subcategory mapped successfully. ${skippedCount} already existed.`
          : "Shop subcategories mapped successfully",
      data,
      meta: {
        createdCount,
        skippedCount,
      },
    });
  } catch (error) {
    console.error("bulkCreateShopSubCategoryMaps error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "One or more subcategories are already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop subcategories"),
    });
  }
}

/**
 * LIST ALL SHOP SUB CATEGORY MAPS
 * GET /api/shop-sub-category-maps
 */
export async function listShopSubCategoryMaps(req: Request, res: Response) {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const shopId = norm(req.query.shopId);
    const subCategoryId = norm(req.query.subCategoryId);
    const categoryId = norm(req.query.categoryId);
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

    if (subCategoryId) {
      if (!isObjectId(subCategoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid subcategory id",
        });
      }

      filter.subCategoryId = subCategoryId;
    }

    if (status === "ACTIVE") filter.isActive = true;
    if (status === "INACTIVE") filter.isActive = false;

    const rows = await buildShopSubCategoryMapQuery(
      ShopSubCategoryMapModel.find(filter).sort({ createdAt: -1 })
    ).lean();

    let data = rows as any[];

    if (categoryId) {
      if (!isObjectId(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category id",
        });
      }

      data = data.filter((row) => {
        const rowCategoryId =
          row.subCategoryId?.categoryId?._id || row.subCategoryId?.categoryId;
        return String(rowCategoryId || "") === categoryId;
      });
    }

    if (search) {
      data = data.filter((row) =>
        matchesSearch(
          [
            row.shopId?.name,
            row.shopId?.shopType,
            row.subCategoryId?.name,
            row.subCategoryId?.categoryId?.name,
            row.subCategoryId?.categoryId?.masterCategoryId?.name,
          ],
          search
        )
      );
    }

    const total = data.length;
    const paginated = data.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      message: "Shop subcategory maps fetched successfully",
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("listShopSubCategoryMaps error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop subcategory maps"),
    });
  }
}

/**
 * GET SINGLE SHOP SUB CATEGORY MAP
 * GET /api/shop-sub-category-maps/:id
 */
export async function getShopSubCategoryMapById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const data = await buildShopSubCategoryMapQuery(
      ShopSubCategoryMapModel.findById(id)
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop subcategory map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop subcategory map fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getShopSubCategoryMapById error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop subcategory map"),
    });
  }
}

/**
 * GET SUB CATEGORIES BY SHOP
 * GET /api/shop-sub-category-maps/shop/:shopId
 */
export async function listShopSubCategoriesByShop(
  req: Request,
  res: Response
) {
  try {
    const { shopId } = req.params;
    const categoryId = norm(req.query.categoryId);
    const search = norm(req.query.search);

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    let data = (await buildShopSubCategoryMapQuery(
      ShopSubCategoryMapModel.find({
        shopId,
        isActive: true,
      }).sort({ createdAt: -1 })
    ).lean()) as any[];

    if (categoryId) {
      if (!isObjectId(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category id",
        });
      }

      data = data.filter((row) => {
        const rowCategoryId =
          row.subCategoryId?.categoryId?._id || row.subCategoryId?.categoryId;
        return String(rowCategoryId || "") === categoryId;
      });
    }

    if (search) {
      data = data.filter((row) =>
        matchesSearch(
          [
            row.subCategoryId?.name,
            row.subCategoryId?.categoryId?.name,
            row.subCategoryId?.categoryId?.masterCategoryId?.name,
          ],
          search
        )
      );
    }

    return res.status(200).json({
      success: true,
      message: "Shop subcategories fetched successfully",
      data,
    });
  } catch (error) {
    console.error("listShopSubCategoriesByShop error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop subcategories"),
    });
  }
}

/**
 * UPDATE MAP STATUS
 * PATCH /api/shop-sub-category-maps/:id
 */
export async function updateShopSubCategoryMap(req: Request, res: Response) {
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

    const data = await buildShopSubCategoryMapQuery(
      ShopSubCategoryMapModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true, runValidators: true }
      )
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop subcategory map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop subcategory map updated successfully",
      data,
    });
  } catch (error) {
    console.error("updateShopSubCategoryMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to update shop subcategory map"),
    });
  }
}

/**
 * TOGGLE STATUS
 * PATCH /api/shop-sub-category-maps/:id/toggle-active
 */
export async function toggleShopSubCategoryMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const existing = await ShopSubCategoryMapModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Shop subcategory map not found",
      });
    }

    existing.isActive = !existing.isActive;
    await existing.save();

    const data = await buildShopSubCategoryMapQuery(
      ShopSubCategoryMapModel.findById(id)
    ).lean();

    return res.status(200).json({
      success: true,
      message: existing.isActive
        ? "Shop subcategory activated successfully"
        : "Shop subcategory deactivated successfully",
      data,
    });
  } catch (error) {
    console.error("toggleShopSubCategoryMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to toggle shop subcategory status"),
    });
  }
}

/**
 * DELETE MAP
 * DELETE /api/shop-sub-category-maps/:id
 */
export async function deleteShopSubCategoryMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const deleted = await ShopSubCategoryMapModel.findByIdAndDelete(id).lean();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Shop subcategory map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop subcategory map deleted successfully",
    });
  } catch (error) {
    console.error("deleteShopSubCategoryMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to delete shop subcategory map"),
    });
  }
}
