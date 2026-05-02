import mongoose from "mongoose";
import type { Request, Response } from "express";
import BarcodeLabelFormatModel, {
  BARCODE_TYPES,
  PAPER_SIZES,
} from "../models/BarcodeLabelFormat.model";

type AuthRequest = Request & {
  user?: {
    _id?: string;
    id?: string;
    shopOwnerAccountId?: string;
    role?: string;
  };
};

const isValidObjectId = (id?: string) =>
  Boolean(id && mongoose.Types.ObjectId.isValid(id));

const getUserId = (req: AuthRequest) =>
  String(req.user?.shopOwnerAccountId || req.user?._id || req.user?.id || "");

const sendError = (
  res: Response,
  status: number,
  message: string,
  error?: unknown
) => {
  return res.status(status).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : undefined,
  });
};

export const listBarcodeLabelFormats = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const shopOwnerAccountId = getUserId(req);
    const shopId = String(req.query.shopId || "");

    if (!isValidObjectId(shopOwnerAccountId)) {
      return sendError(res, 401, "Unauthorized user");
    }

    if (!isValidObjectId(shopId)) {
      return sendError(res, 400, "Valid shopId required");
    }

    const formats = await BarcodeLabelFormatModel.find({
      shopOwnerAccountId,
      shopId,
      isActive: true,
    })
      .sort({ isUse: -1, createdAt: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: formats,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to list label formats", error);
  }
};

export const getUseBarcodeLabelFormat = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const shopOwnerAccountId = getUserId(req);
    const shopId = String(req.query.shopId || "");

    if (!isValidObjectId(shopOwnerAccountId)) {
      return sendError(res, 401, "Unauthorized user");
    }

    if (!isValidObjectId(shopId)) {
      return sendError(res, 400, "Valid shopId required");
    }

    const format = await BarcodeLabelFormatModel.findOne({
      shopOwnerAccountId,
      shopId,
      isUse: true,
      isActive: true,
    }).lean();

    return res.status(200).json({
      success: true,
      data: format || null,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to get label format", error);
  }
};

export const createBarcodeLabelFormat = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const shopOwnerAccountId = getUserId(req);
    const shopId = String(req.body.shopId || "");

    if (!isValidObjectId(shopOwnerAccountId)) {
      return sendError(res, 401, "Unauthorized user");
    }

    if (!isValidObjectId(shopId)) {
      return sendError(res, 400, "Valid shopId required");
    }

    const existingCount = await BarcodeLabelFormatModel.countDocuments({
      shopOwnerAccountId,
      shopId,
      isActive: true,
    });

    const shouldUse = Boolean(req.body.isUse) || existingCount === 0;

    if (shouldUse) {
      await BarcodeLabelFormatModel.updateMany(
        { shopOwnerAccountId, shopId },
        { $set: { isUse: false } }
      );
    }

    const created = await BarcodeLabelFormatModel.create({
      shopOwnerAccountId,
      shopId,
      name: String(req.body.name || existingCount + 1),
      scheme: String(req.body.scheme || "4x4"),
      paperSize: String(req.body.paperSize || "A4"),
      labelWidth: Number(req.body.labelWidth || 39),
      labelHeight: Number(req.body.labelHeight || 35),
      leftMargin: Number(req.body.leftMargin || 0),
      topMargin: Number(req.body.topMargin || 1),
      horizontalGap: Number(req.body.horizontalGap || 0),
      verticalGap: Number(req.body.verticalGap || 1),
      noOfColumns: Number(req.body.noOfColumns || 5),
      currency: String(req.body.currency || "Rs."),
      barcodeType: String(req.body.barcodeType || "CODE128"),
      fields: Array.isArray(req.body.fields)
        ? req.body.fields
        : ["NAME", "BARCODE", "MRP"],
      isUse: shouldUse,
    });

    return res.status(201).json({
      success: true,
      message: "Label format created successfully",
      data: created,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to create label format", error);
  }
};

export const updateBarcodeLabelFormat = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const shopOwnerAccountId = getUserId(req);
    const id = String(req.params.id || "");

    if (!isValidObjectId(shopOwnerAccountId)) {
      return sendError(res, 401, "Unauthorized user");
    }

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Valid label format id required");
    }

    const current = await BarcodeLabelFormatModel.findOne({
      _id: id,
      shopOwnerAccountId,
      isActive: true,
    });

    if (!current) {
      return sendError(res, 404, "Label format not found");
    }

    const shouldUse = Boolean(req.body.isUse);

    if (shouldUse) {
      await BarcodeLabelFormatModel.updateMany(
        {
          shopOwnerAccountId,
          shopId: current.shopId,
          _id: { $ne: current._id },
        },
        { $set: { isUse: false } }
      );
    }

    current.name = String(req.body.name || current.name);
    current.scheme = String(req.body.scheme || current.scheme);

    const paperSize = String(req.body.paperSize || current.paperSize);
    const barcodeType = String(req.body.barcodeType || current.barcodeType);

    current.paperSize = PAPER_SIZES.includes(paperSize as any)
      ? (paperSize as typeof PAPER_SIZES[number])
      : current.paperSize;

    current.labelWidth = Number(req.body.labelWidth ?? current.labelWidth);
    current.labelHeight = Number(req.body.labelHeight ?? current.labelHeight);
    current.leftMargin = Number(req.body.leftMargin ?? current.leftMargin);
    current.topMargin = Number(req.body.topMargin ?? current.topMargin);
    current.horizontalGap = Number(
      req.body.horizontalGap ?? current.horizontalGap
    );
    current.verticalGap = Number(req.body.verticalGap ?? current.verticalGap);
    current.noOfColumns = Number(req.body.noOfColumns ?? current.noOfColumns);
    current.currency = String(req.body.currency ?? current.currency);

    current.barcodeType = BARCODE_TYPES.includes(barcodeType as any)
      ? (barcodeType as typeof BARCODE_TYPES[number])
      : current.barcodeType;

    if (Array.isArray(req.body.fields)) {
      current.fields = req.body.fields;
    }

    if (typeof req.body.isUse === "boolean") {
      current.isUse = req.body.isUse;
    }

    await current.save();

    return res.status(200).json({
      success: true,
      message: "Label format updated successfully",
      data: current,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to update label format", error);
  }
};

export const setUseBarcodeLabelFormat = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const shopOwnerAccountId = getUserId(req);
    const id = String(req.params.id || "");

    if (!isValidObjectId(shopOwnerAccountId)) {
      return sendError(res, 401, "Unauthorized user");
    }

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Valid label format id required");
    }

    const format = await BarcodeLabelFormatModel.findOne({
      _id: id,
      shopOwnerAccountId,
      isActive: true,
    });

    if (!format) {
      return sendError(res, 404, "Label format not found");
    }

    await BarcodeLabelFormatModel.updateMany(
      {
        shopOwnerAccountId,
        shopId: format.shopId,
      },
      { $set: { isUse: false } }
    );

    format.isUse = true;
    await format.save();

    return res.status(200).json({
      success: true,
      message: "Label format selected for printing",
      data: format,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to select label format", error);
  }
};

export const deleteBarcodeLabelFormat = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const shopOwnerAccountId = getUserId(req);
    const id = String(req.params.id || "");

    if (!isValidObjectId(shopOwnerAccountId)) {
      return sendError(res, 401, "Unauthorized user");
    }

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Valid label format id required");
    }

    const deleted = await BarcodeLabelFormatModel.findOneAndUpdate(
      {
        _id: id,
        shopOwnerAccountId,
        isActive: true,
      },
      {
        $set: {
          isActive: false,
          isUse: false,
        },
      },
      { new: true }
    );

    if (!deleted) {
      return sendError(res, 404, "Label format not found");
    }

    const useExists = await BarcodeLabelFormatModel.exists({
      shopOwnerAccountId,
      shopId: deleted.shopId,
      isActive: true,
      isUse: true,
    });

    if (!useExists) {
      const first = await BarcodeLabelFormatModel.findOne({
        shopOwnerAccountId,
        shopId: deleted.shopId,
        isActive: true,
      }).sort({ createdAt: 1 });

      if (first) {
        first.isUse = true;
        await first.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: "Label format deleted successfully",
    });
  } catch (error) {
    return sendError(res, 500, "Failed to delete label format", error);
  }
};