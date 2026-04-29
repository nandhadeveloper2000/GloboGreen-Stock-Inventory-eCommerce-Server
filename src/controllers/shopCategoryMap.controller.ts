import { Request, Response } from "express";
import mongoose from "mongoose";
import { ShopCategoryMapModel } from "../models/shopCategoryMap.model";
import { ShopModel } from "../models/shop.model";
import { CategoryModel } from "../models/category.model";

const isObjectId = (id: unknown) => mongoose.Types.ObjectId.isValid(String(id));

const norm = (value: unknown) => String(value ?? "").trim();

type AuthRequest = Request & {
  user?: {
    sub?: string;
    _id?: string;
    id?: string;
    role?: string;
  };
};

type CreatedByRef = "Master" | "Staff" | "ShopOwner" | "ShopStaff";

type CreatedByType = "MASTER" | "MANAGER" | "SHOP_OWNER" | "SHOP_STAFF";

type CreatedBy = {
  type: CreatedByType;
  id: string;
  role: string;
  ref: CreatedByRef;
};

type MongoError = Error & {
  code?: number;
  keyPattern?: Record<string, number>;
  keyValue?: Record<string, unknown>;
};

function getUserId(req: AuthRequest) {
  return req.user?.sub || req.user?._id || req.user?.id || "";
}

function getUserRole(req: AuthRequest) {
  return norm(req.user?.role).toUpperCase();
}

function buildCreatedBy(req: AuthRequest): CreatedBy {
  const role = getUserRole(req);
  const userId = getUserId(req);

  if (!userId || !isObjectId(userId)) {
    throw new Error("Invalid user session");
  }

  if (role === "MASTER_ADMIN") {
    return {
      type: "MASTER",
      id: userId,
      role,
      ref: "Master",
    };
  }

  if (role === "MANAGER") {
    return {
      type: "MANAGER",
      id: userId,
      role,
      ref: "Staff",
    };
  }

  if (role === "SHOP_OWNER") {
    return {
      type: "SHOP_OWNER",
      id: userId,
      role,
      ref: "ShopOwner",
    };
  }

  return {
    type: "SHOP_STAFF",
    id: userId,
    role,
    ref: "ShopStaff",
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * CREATE SHOP CATEGORY MAP
 * POST /api/shop-category-maps
 */
export async function createShopCategoryMap(req: AuthRequest, res: Response) {
  try {
    const { shopId, categoryId, isActive = true } = req.body as {
      shopId?: string;
      categoryId?: string;
      isActive?: boolean;
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!isObjectId(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category id",
      });
    }

    const [shop, category] = await Promise.all([
      ShopModel.findById(shopId).select("_id shopName name isActive").lean(),
      CategoryModel.findById(categoryId)
        .select("_id masterCategoryId name isActive")
        .lean(),
    ]);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    if (category.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Inactive category cannot be mapped",
      });
    }

    const existingMap = await ShopCategoryMapModel.findOne({
      shopId,
      categoryId,
    })
      .select("_id isActive")
      .lean();

    if (existingMap) {
      return res.status(409).json({
        success: false,
        message: "This category is already mapped to this shop",
        data: existingMap,
      });
    }

    const createdBy = buildCreatedBy(req);

    const created = await ShopCategoryMapModel.create({
      shopId,
      categoryId,
      masterCategoryId: category.masterCategoryId,
      isActive: Boolean(isActive),
      createdBy,
    });

    const data = await ShopCategoryMapModel.findById(created._id)
      .populate("shopId", "shopName name code shopType")
      .populate("masterCategoryId", "name")
      .populate("categoryId", "name image isActive")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Shop category mapped successfully",
      data,
    });
  } catch (error) {
    console.error("createShopCategoryMap error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This category is already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop category"),
    });
  }
}

/**
 * BULK CREATE SHOP CATEGORY MAPS
 * POST /api/shop-category-maps/bulk
 */
export async function bulkCreateShopCategoryMaps(
  req: AuthRequest,
  res: Response
) {
  try {
    const { shopId, categoryIds = [] } = req.body as {
      shopId?: string;
      categoryIds?: string[];
    };

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one category",
      });
    }

    const cleanCategoryIds = Array.from(
      new Set(categoryIds.map((id) => String(id)).filter(isObjectId))
    );

    if (!cleanCategoryIds.length) {
      return res.status(400).json({
        success: false,
        message: "No valid category ids found",
      });
    }

    const shop = await ShopModel.findById(shopId)
      .select("_id shopName name isActive")
      .lean();

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    const categories = await CategoryModel.find({
      _id: { $in: cleanCategoryIds },
      isActive: true,
    })
      .select("_id masterCategoryId name")
      .lean();

    if (!categories.length) {
      return res.status(404).json({
        success: false,
        message: "No active categories found",
      });
    }

    const existingMaps = await ShopCategoryMapModel.find({
      shopId,
      categoryId: { $in: categories.map((category) => category._id) },
    })
      .select("categoryId")
      .lean();

    const existingCategoryIds = new Set(
      existingMaps.map((map) => String(map.categoryId))
    );

    const newCategories = categories.filter(
      (category) => !existingCategoryIds.has(String(category._id))
    );

    if (!newCategories.length) {
      return res.status(409).json({
        success: false,
        message: "Selected categories are already mapped to this shop",
        meta: {
          createdCount: 0,
          skippedCount: existingMaps.length,
        },
      });
    }

    const createdBy = buildCreatedBy(req);

    const docs = newCategories.map((category) => ({
      shopId,
      categoryId: category._id,
      masterCategoryId: category.masterCategoryId,
      isActive: true,
      createdBy,
    }));

    await ShopCategoryMapModel.insertMany(docs, { ordered: false });

    const data = await ShopCategoryMapModel.find({
      shopId,
      categoryId: { $in: newCategories.map((category) => category._id) },
    })
      .populate("shopId", "shopName name code shopType")
      .populate("masterCategoryId", "name")
      .populate("categoryId", "name image isActive")
      .sort({ createdAt: -1 })
      .lean();

    const createdCount = newCategories.length;
    const skippedCount = existingMaps.length;

    return res.status(201).json({
      success: true,
      message:
        skippedCount > 0
          ? `${createdCount} category mapped successfully. ${skippedCount} already existed.`
          : "Shop categories mapped successfully",
      data,
      meta: {
        createdCount,
        skippedCount,
      },
    });
  } catch (error) {
    console.error("bulkCreateShopCategoryMaps error:", error);

    const mongoError = error as MongoError;

    if (mongoError?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "One or more categories are already mapped to this shop",
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to map shop categories"),
    });
  }
}

/**
 * LIST ALL SHOP CATEGORY MAPS
 * GET /api/shop-category-maps
 */
export async function listShopCategoryMaps(req: Request, res: Response) {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const skip = (page - 1) * limit;

    const shopId = norm(req.query.shopId);
    const categoryId = norm(req.query.categoryId);
    const status = norm(req.query.status).toUpperCase();
    const search = norm(req.query.search);

    const filter: Record<string, unknown> = {};

    if (shopId && isObjectId(shopId)) {
      filter.shopId = new mongoose.Types.ObjectId(shopId);
    }

    if (categoryId && isObjectId(categoryId)) {
      filter.categoryId = new mongoose.Types.ObjectId(categoryId);
    }

    if (status === "ACTIVE") {
      filter.isActive = true;
    }

    if (status === "INACTIVE") {
      filter.isActive = false;
    }

    const pipeline: mongoose.PipelineStage[] = [
      { $match: filter },

      {
        $lookup: {
          from: "shops",
          localField: "shopId",
          foreignField: "_id",
          as: "shop",
        },
      },
      { $unwind: { path: "$shop", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "mastercategories",
          localField: "masterCategoryId",
          foreignField: "_id",
          as: "masterCategory",
        },
      },
      {
        $unwind: {
          path: "$masterCategory",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $lookup: {
          from: "categories",
          localField: "categoryId",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
    ];

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");

      pipeline.push({
        $match: {
          $or: [
            { "shop.shopName": regex },
            { "shop.name": regex },
            { "shop.code": regex },
            { "category.name": regex },
            { "masterCategory.name": regex },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        data: [
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              shopId: 1,
              masterCategoryId: 1,
              categoryId: 1,
              isActive: 1,
              createdBy: 1,
              createdAt: 1,
              updatedAt: 1,
              shop: {
                _id: "$shop._id",
                shopName: "$shop.shopName",
                name: "$shop.name",
                code: "$shop.code",
                shopType: "$shop.shopType",
              },
              masterCategory: {
                _id: "$masterCategory._id",
                name: "$masterCategory.name",
              },
              category: {
                _id: "$category._id",
                name: "$category.name",
                image: "$category.image",
                isActive: "$category.isActive",
              },
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    });

    const result = await ShopCategoryMapModel.aggregate(pipeline);

    const data = result?.[0]?.data || [];
    const total = result?.[0]?.total?.[0]?.count || 0;

    return res.status(200).json({
      success: true,
      message: "Shop category maps fetched successfully",
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("listShopCategoryMaps error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop category maps"),
    });
  }
}

/**
 * GET SINGLE SHOP CATEGORY MAP
 * GET /api/shop-category-maps/:id
 */
export async function getShopCategoryMapById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const data = await ShopCategoryMapModel.findById(id)
      .populate("shopId", "shopName name code shopType")
      .populate("masterCategoryId", "name")
      .populate("categoryId", "name image isActive")
      .lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop category map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop category map fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getShopCategoryMapById error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop category map"),
    });
  }
}

/**
 * GET CATEGORIES BY SHOP
 * GET /api/shop-category-maps/shop/:shopId
 */
export async function listShopCategoriesByShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const rows = await ShopCategoryMapModel.find({
      shopId,
      isActive: true,
    })
      .populate({
        path: "categoryId",
        select: "name image masterCategoryId isActive",
        populate: {
          path: "masterCategoryId",
          select: "name image isActive",
        },
      })
      .populate("shopId", "shopName name code shopType")
      .populate("masterCategoryId", "name")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Shop categories fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("listShopCategoriesByShop error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to fetch shop categories"),
    });
  }
}

/**
 * UPDATE MAP STATUS
 * PATCH /api/shop-category-maps/:id
 */
export async function updateShopCategoryMap(req: Request, res: Response) {
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

    const data = await ShopCategoryMapModel.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    )
      .populate("shopId", "shopName name code shopType")
      .populate("masterCategoryId", "name")
      .populate("categoryId", "name image isActive")
      .lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop category map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop category map updated successfully",
      data,
    });
  } catch (error) {
    console.error("updateShopCategoryMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to update shop category map"),
    });
  }
}

/**
 * TOGGLE STATUS
 * PATCH /api/shop-category-maps/:id/toggle-active
 */
export async function toggleShopCategoryMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const existing = await ShopCategoryMapModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Shop category map not found",
      });
    }

    existing.isActive = !existing.isActive;
    await existing.save();

    const data = await ShopCategoryMapModel.findById(id)
      .populate("shopId", "shopName name code shopType")
      .populate("masterCategoryId", "name")
      .populate("categoryId", "name image isActive")
      .lean();

    return res.status(200).json({
      success: true,
      message: existing.isActive
        ? "Shop category activated successfully"
        : "Shop category deactivated successfully",
      data,
    });
  } catch (error) {
    console.error("toggleShopCategoryMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to toggle shop category status"),
    });
  }
}

/**
 * DELETE MAP
 * DELETE /api/shop-category-maps/:id
 */
export async function deleteShopCategoryMap(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid map id",
      });
    }

    const deleted = await ShopCategoryMapModel.findByIdAndDelete(id).lean();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Shop category map not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop category map deleted successfully",
    });
  } catch (error) {
    console.error("deleteShopCategoryMap error:", error);

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error, "Failed to delete shop category map"),
    });
  }
} 