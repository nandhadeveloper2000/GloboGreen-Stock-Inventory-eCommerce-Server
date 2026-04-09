import type { Request, Response } from "express";
import mongoose from "mongoose";

import CompatibleModel from "../models/compatible.model";
import { ProductTypeModel } from "../models/productType.model";
import { BrandModel } from "../models/brand.model";
import { ModelModel } from "../models/model.model";

type CompatibleItemInput = {
  brandId?: string;
  modelIds?: string[];
};

const isValidObjectId = (id?: string | null): boolean => {
  return !!id && mongoose.Types.ObjectId.isValid(id);
};

const getStringValue = (value?: string | string[]): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const normalizeCompatibleItems = (
  compatibleItems: unknown
): Array<{ brandId: string; modelIds: string[] }> => {
  if (!Array.isArray(compatibleItems)) return [];

  return compatibleItems
    .map((item: CompatibleItemInput) => {
      const brandId = item?.brandId?.toString().trim() || "";
      const modelIds = Array.isArray(item?.modelIds)
        ? [...new Set(item.modelIds.map((id) => id?.toString().trim()).filter(Boolean))]
        : [];

      return { brandId, modelIds };
    })
    .filter((item) => item.brandId && item.modelIds.length > 0);
};

const buildCreatedBy = (req: Request) => {
  const user = (req as Request & {
    user?: {
      _id?: string;
      id?: string;
      role?: string;
    };
  }).user;

  return {
    id: user?._id || user?.id || undefined,
    role: user?.role || undefined,
  };
};

const validateCompatibleItems = async (
  compatibleItems: Array<{ brandId: string; modelIds: string[] }>
): Promise<{ valid: boolean; message?: string; status?: number }> => {
  for (const item of compatibleItems) {
    if (!isValidObjectId(item.brandId)) {
      return {
        valid: false,
        status: 400,
        message: "One or more compatible brandId values are invalid.",
      };
    }

    const validModelIds = item.modelIds.every((id) => isValidObjectId(id));
    if (!validModelIds) {
      return {
        valid: false,
        status: 400,
        message: "One or more compatible modelIds are invalid.",
      };
    }

    const [compatibleBrandExists, compatibleModelsCount] = await Promise.all([
      BrandModel.exists({ _id: item.brandId }),
      ModelModel.countDocuments({ _id: { $in: item.modelIds } }),
    ]);

    if (!compatibleBrandExists) {
      return {
        valid: false,
        status: 404,
        message: "One or more compatible brands not found.",
      };
    }

    if (compatibleModelsCount !== item.modelIds.length) {
      return {
        valid: false,
        status: 404,
        message: "One or more compatible models not found.",
      };
    }
  }

  return { valid: true };
};

export const createCompatible = async (req: Request, res: Response) => {
  try {
    const { productTypeId, brandId, modelId, compatibleItems, notes } = req.body;

    if (!isValidObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Valid productTypeId is required.",
      });
    }

    if (!isValidObjectId(brandId)) {
      return res.status(400).json({
        success: false,
        message: "Valid brandId is required.",
      });
    }

    if (!isValidObjectId(modelId)) {
      return res.status(400).json({
        success: false,
        message: "Valid modelId is required.",
      });
    }

    const normalizedCompatibleItems = normalizeCompatibleItems(compatibleItems);

    if (!normalizedCompatibleItems.length) {
      return res.status(400).json({
        success: false,
        message: "At least one compatible brand/model mapping is required.",
      });
    }

    const [productTypeExists, brandExists, modelExists] = await Promise.all([
      ProductTypeModel.exists({ _id: productTypeId }),
      BrandModel.exists({ _id: brandId }),
      ModelModel.exists({ _id: modelId }),
    ]);

    if (!productTypeExists) {
      return res.status(404).json({
        success: false,
        message: "Product type not found.",
      });
    }

    if (!brandExists) {
      return res.status(404).json({
        success: false,
        message: "Main brand not found.",
      });
    }

    if (!modelExists) {
      return res.status(404).json({
        success: false,
        message: "Main model not found.",
      });
    }

    const validation = await validateCompatibleItems(normalizedCompatibleItems);
    if (!validation.valid) {
      return res.status(validation.status || 400).json({
        success: false,
        message: validation.message,
      });
    }

    const alreadyExists = await CompatibleModel.findOne({
      productTypeId,
      brandId,
      modelId,
    }).lean();

    if (alreadyExists) {
      return res.status(409).json({
        success: false,
        message: "Compatibility already exists for this product type, brand and model.",
      });
    }

    const compatible = await CompatibleModel.create({
      productTypeId,
      brandId,
      modelId,
      compatibleItems: normalizedCompatibleItems,
      notes: typeof notes === "string" ? notes.trim() : "",
      createdBy: buildCreatedBy(req),
    });

    const populated = await CompatibleModel.findById(compatible._id)
      .populate("productTypeId", "name nameKey")
      .populate("brandId", "name nameKey")
      .populate("modelId", "name nameKey brandId")
      .populate("compatibleItems.brandId", "name nameKey")
      .populate("compatibleItems.modelIds", "name nameKey brandId");

    return res.status(201).json({
      success: true,
      message: "Compatibility created successfully.",
      data: populated,
    });
  } catch (error) {
    console.error("createCompatible error:", error);

    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Compatibility already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create compatibility.",
    });
  }
};

export const listCompatibles = async (req: Request, res: Response) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.max(Number(req.query.limit) || 10, 1);
    const skip = (page - 1) * limit;

    const rawSearch = getStringValue(req.query.search as string | string[]);
    const rawProductTypeId = getStringValue(req.query.productTypeId as string | string[]);
    const rawBrandId = getStringValue(req.query.brandId as string | string[]);
    const rawModelId = getStringValue(req.query.modelId as string | string[]);
    const rawIsActive = getStringValue(req.query.isActive as string | string[]);

    const search = rawSearch?.trim() || "";

    const query: Record<string, unknown> = {};

    if (isValidObjectId(rawProductTypeId)) query.productTypeId = rawProductTypeId;
    if (isValidObjectId(rawBrandId)) query.brandId = rawBrandId;
    if (isValidObjectId(rawModelId)) query.modelId = rawModelId;

    if (typeof rawIsActive === "string") {
      query.isActive = rawIsActive === "true";
    }

    if (search) {
      const regex = new RegExp(search, "i");

      const [productTypes, brands, models] = await Promise.all([
        ProductTypeModel.find({ name: regex }).select("_id").lean(),
        BrandModel.find({ name: regex }).select("_id").lean(),
        ModelModel.find({ name: regex }).select("_id").lean(),
      ]);

      const productTypeIds = productTypes.map((item: { _id: mongoose.Types.ObjectId }) => item._id);
      const brandIds = brands.map((item: { _id: mongoose.Types.ObjectId }) => item._id);
      const modelIds = models.map((item: { _id: mongoose.Types.ObjectId }) => item._id);

      const matchedCompatibles = await CompatibleModel.find({
        $or: [
          { productTypeId: { $in: productTypeIds } },
          { brandId: { $in: brandIds } },
          { modelId: { $in: modelIds } },
          { "compatibleItems.brandId": { $in: brandIds } },
          { "compatibleItems.modelIds": { $in: modelIds } },
          { notes: regex },
        ],
      })
        .select("_id")
        .lean();

      const compatibleIdsFromSearch = matchedCompatibles.map(
        (item: { _id: mongoose.Types.ObjectId }) => item._id
      );

      query._id = { $in: compatibleIdsFromSearch };
    }

    const [items, total] = await Promise.all([
      CompatibleModel.find(query)
        .populate("productTypeId", "name nameKey")
        .populate("brandId", "name nameKey")
        .populate("modelId", "name nameKey brandId")
        .populate("compatibleItems.brandId", "name nameKey")
        .populate("compatibleItems.modelIds", "name nameKey brandId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CompatibleModel.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      message: "Compatibility list fetched successfully.",
      data: items,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("listCompatibles error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch compatibility list.",
    });
  }
};

export const getCompatible = async (req: Request, res: Response) => {
  try {
    const id = getStringValue(req.params.id);

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id.",
      });
    }

    const compatible = await CompatibleModel.findById(id)
      .populate("productTypeId", "name nameKey")
      .populate("brandId", "name nameKey")
      .populate("modelId", "name nameKey brandId")
      .populate("compatibleItems.brandId", "name nameKey")
      .populate("compatibleItems.modelIds", "name nameKey brandId");

    if (!compatible) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Compatibility fetched successfully.",
      data: compatible,
    });
  } catch (error) {
    console.error("getCompatible error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch compatibility.",
    });
  }
};

export const updateCompatible = async (req: Request, res: Response) => {
  try {
    const id = getStringValue(req.params.id);

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id.",
      });
    }

    const existing = await CompatibleModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found.",
      });
    }

    const { productTypeId, brandId, modelId, compatibleItems, notes, isActive } = req.body;

    if (productTypeId && !isValidObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Valid productTypeId is required.",
      });
    }

    if (brandId && !isValidObjectId(brandId)) {
      return res.status(400).json({
        success: false,
        message: "Valid brandId is required.",
      });
    }

    if (modelId && !isValidObjectId(modelId)) {
      return res.status(400).json({
        success: false,
        message: "Valid modelId is required.",
      });
    }

    const nextProductTypeId = productTypeId || existing.productTypeId.toString();
    const nextBrandId = brandId || existing.brandId.toString();
    const nextModelId = modelId || existing.modelId.toString();

    const [productTypeExists, brandExists, modelExists] = await Promise.all([
      ProductTypeModel.exists({ _id: nextProductTypeId }),
      BrandModel.exists({ _id: nextBrandId }),
      ModelModel.exists({ _id: nextModelId }),
    ]);

    if (!productTypeExists) {
      return res.status(404).json({
        success: false,
        message: "Product type not found.",
      });
    }

    if (!brandExists) {
      return res.status(404).json({
        success: false,
        message: "Main brand not found.",
      });
    }

    if (!modelExists) {
      return res.status(404).json({
        success: false,
        message: "Main model not found.",
      });
    }

    const updateData: Record<string, unknown> = {
      productTypeId: nextProductTypeId,
      brandId: nextBrandId,
      modelId: nextModelId,
    };

    if (typeof notes === "string") {
      updateData.notes = notes.trim();
    }

    if (typeof isActive === "boolean") {
      updateData.isActive = isActive;
    }

    if (compatibleItems !== undefined) {
      const normalizedCompatibleItems = normalizeCompatibleItems(compatibleItems);

      if (!normalizedCompatibleItems.length) {
        return res.status(400).json({
          success: false,
          message: "At least one compatible brand/model mapping is required.",
        });
      }

      const validation = await validateCompatibleItems(normalizedCompatibleItems);
      if (!validation.valid) {
        return res.status(validation.status || 400).json({
          success: false,
          message: validation.message,
        });
      }

      updateData.compatibleItems = normalizedCompatibleItems;
    }

    const duplicate = await CompatibleModel.findOne({
      _id: { $ne: id },
      productTypeId: nextProductTypeId,
      brandId: nextBrandId,
      modelId: nextModelId,
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Another compatibility already exists with this product type, brand and model.",
      });
    }

    await CompatibleModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    const updated = await CompatibleModel.findById(id)
      .populate("productTypeId", "name nameKey")
      .populate("brandId", "name nameKey")
      .populate("modelId", "name nameKey brandId")
      .populate("compatibleItems.brandId", "name nameKey")
      .populate("compatibleItems.modelIds", "name nameKey brandId");

    return res.status(200).json({
      success: true,
      message: "Compatibility updated successfully.",
      data: updated,
    });
  } catch (error) {
    console.error("updateCompatible error:", error);

    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Compatibility already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update compatibility.",
    });
  }
};

export const toggleCompatibleActive = async (req: Request, res: Response) => {
  try {
    const id = getStringValue(req.params.id);

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id.",
      });
    }

    const compatible = await CompatibleModel.findById(id);

    if (!compatible) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found.",
      });
    }

    compatible.isActive = !compatible.isActive;
    await compatible.save();

    return res.status(200).json({
      success: true,
      message: `Compatibility ${compatible.isActive ? "activated" : "deactivated"} successfully.`,
      data: compatible,
    });
  } catch (error) {
    console.error("toggleCompatibleActive error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update compatibility status.",
    });
  }
};

export const deleteCompatible = async (req: Request, res: Response) => {
  try {
    const id = getStringValue(req.params.id);

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id.",
      });
    }

    const deleted = await CompatibleModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Compatibility deleted successfully.",
    });
  } catch (error) {
    console.error("deleteCompatible error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete compatibility.",
    });
  }
};