import { Request, Response } from "express";
import mongoose from "mongoose";
import { DiscountModel, DISCOUNT_TYPE, DISCOUNT_APPLY_ON } from "../models/discount.model";
import { CategoryModel } from "../models/category.model";
import { ProductModel } from "../models/product.model";
import { SubCategoryModel } from "../models/subcategory.model";

type AuthUser = { sub?: string; id?: string; _id?: string; role?: string; shopOwnerAccountId?: string; ownerId?: string };
type AuthedRequest = Request & { user?: AuthUser };

function norm(v: unknown) { return String(v ?? "").trim(); }
function isObjId(v: unknown) { return mongoose.Types.ObjectId.isValid(String(v)); }
function getBody(req: Request) { return (req.body ?? {}) as Record<string, unknown>; }
function getQuery(req: Request) { return (req.query ?? {}) as Record<string, unknown>; }
function getUserId(req: AuthedRequest) { return norm(req.user?.sub || req.user?.id || req.user?._id); }
function getUserRole(req: AuthedRequest) { return norm(req.user?.role).toUpperCase(); }
function getShopId(req: Request) { const b = getBody(req); const q = getQuery(req); return norm(q.shopId || b.shopId); }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function resolveOwnerAccountId(req: AuthedRequest) {
  const role = getUserRole(req);
  const userId = getUserId(req);
  const b = getBody(req); const q = getQuery(req);
  const tokenOwnerId = norm(req.user?.shopOwnerAccountId || req.user?.ownerId);
  const candidate = norm(b.shopOwnerAccountId || q.shopOwnerAccountId);
  if (role === "SHOP_OWNER" && isObjId(userId)) return userId;
  if (tokenOwnerId && isObjId(tokenOwnerId)) return tokenOwnerId;
  if (candidate && isObjId(candidate)) return candidate;
  return "";
}

function buildCreatedBy(req: AuthedRequest) {
  const userId = getUserId(req);
  const role = getUserRole(req);
  if (!userId || !isObjId(userId)) throw new Error("Valid user id required");
  return { id: new mongoose.Types.ObjectId(userId), role: role || "UNKNOWN" };
}

function parseDate(v: unknown) {
  const raw = norm(v);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getObjectIdText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "_id" in value) {
    return norm((value as { _id?: unknown })._id);
  }
  return norm(value);
}

function normalizeObjectIdArray(values: unknown[]) {
  const seen = new Set<string>();
  const ids: mongoose.Types.ObjectId[] = [];

  values.forEach((value) => {
    const id = getObjectIdText(value);
    if (!id || !isObjId(id) || seen.has(id)) return;
    seen.add(id);
    ids.push(new mongoose.Types.ObjectId(id));
  });

  return ids;
}

type ApplicableResponseItem = {
  _id: string;
  name: string;
  categoryName?: string;
};

type DiscountResponseRow = {
  applyOn?: string;
  applicableIds?: unknown[];
  [key: string]: unknown;
};

async function resolveApplicableItems<T extends DiscountResponseRow>(rows: T[]) {
  const categoryIds = new Set<string>();
  const subCategoryIds = new Set<string>();
  const productIds = new Set<string>();

  rows.forEach((row) => {
    const applyOn = norm(row.applyOn).toUpperCase();
    const ids = Array.isArray(row.applicableIds) ? row.applicableIds : [];

    ids.forEach((value) => {
      const id = getObjectIdText(value);
      if (!id || !isObjId(id)) return;

      if (applyOn === "CATEGORY") categoryIds.add(id);
      if (applyOn === "SUBCATEGORY") subCategoryIds.add(id);
      if (applyOn === "PRODUCT") productIds.add(id);
    });
  });

  const [categories, subCategories, products] = await Promise.all([
    categoryIds.size
      ? CategoryModel.find({
          _id: {
            $in: Array.from(categoryIds).map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("name")
          .lean()
      : Promise.resolve([]),
    subCategoryIds.size
      ? SubCategoryModel.find({
          _id: {
            $in: Array.from(subCategoryIds).map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("name categoryId")
          .populate({
            path: "categoryId",
            select: "name",
          })
          .lean()
      : Promise.resolve([]),
    productIds.size
      ? ProductModel.find({
          _id: {
            $in: Array.from(productIds).map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("itemName")
          .lean()
      : Promise.resolve([]),
  ]);

  const categoryLookup = new Map<string, ApplicableResponseItem>(
    categories.map((item) => [
      String(item._id),
      {
        _id: String(item._id),
        name: item.name || "Unnamed Category",
      },
    ])
  );

  const subCategoryLookup = new Map<string, ApplicableResponseItem>(
    subCategories.map((item) => {
      const category =
        item.categoryId && typeof item.categoryId === "object"
          ? item.categoryId
          : null;

      return [
        String(item._id),
        {
          _id: String(item._id),
          name: item.name || "Unnamed Subcategory",
          categoryName: norm(category?.name),
        },
      ];
    })
  );

  const productLookup = new Map<string, ApplicableResponseItem>(
    products.map((item) => [
      String(item._id),
      { _id: String(item._id), name: item.itemName || "Unnamed Product" },
    ])
  );

  return rows.map((row) => {
    const applyOn = norm(row.applyOn).toUpperCase();
    const ids = Array.isArray(row.applicableIds) ? row.applicableIds : [];

    const applicableItems = ids
      .map((value) => {
        const id = getObjectIdText(value);
        if (!id || !isObjId(id)) return null;
        if (applyOn === "CATEGORY") return categoryLookup.get(id) || null;
        if (applyOn === "SUBCATEGORY") return subCategoryLookup.get(id) || null;
        if (applyOn === "PRODUCT") return productLookup.get(id) || null;
        return null;
      })
      .filter(Boolean) as ApplicableResponseItem[];

    return {
      ...row,
      applicableItems,
    };
  });
}

async function validateApplicableIds(
  applyOn: string,
  applicableIds: mongoose.Types.ObjectId[]
) {
  if (applyOn === "ORDER") return true;
  if (applicableIds.length === 0) return false;

  if (applyOn === "CATEGORY") {
    const count = await CategoryModel.countDocuments({
      _id: { $in: applicableIds },
    });
    return count === applicableIds.length;
  }

  if (applyOn === "SUBCATEGORY") {
    const count = await SubCategoryModel.countDocuments({
      _id: { $in: applicableIds },
    });
    return count === applicableIds.length;
  }

  if (applyOn === "PRODUCT") {
    const count = await ProductModel.countDocuments({
      _id: { $in: applicableIds },
    });
    return count === applicableIds.length;
  }

  return false;
}

export async function listDiscounts(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid.", data: [] });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required", data: [] });
    }

    const q = norm(req.query?.q);
    const isActiveParam = req.query?.isActive;
    const filter: Record<string, unknown> = {
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
    };

    if (isActiveParam !== undefined) {
      filter.isActive = String(isActiveParam) === "true";
    }
    if (q) {
      filter.$or = [
        { code: new RegExp(escapeRegex(q), "i") },
        { description: new RegExp(escapeRegex(q), "i") },
      ];
    }

    const rows = await DiscountModel.find(filter).sort({ createdAt: -1 }).lean();
    const data = await resolveApplicableItems(rows as DiscountResponseRow[]);
    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("LIST_DISCOUNTS_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to list discounts", data: [] });
  }
}

export async function createDiscount(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);
    const body = getBody(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const code = norm(body.code).toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: "Discount code required" });

    const discountType = norm(body.discountType).toUpperCase();
    if (!DISCOUNT_TYPE.includes(discountType as typeof DISCOUNT_TYPE[number])) {
      return res.status(400).json({ success: false, message: `discountType must be one of: ${DISCOUNT_TYPE.join(", ")}` });
    }

    const value = Number(body.value ?? 0);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ success: false, message: "Valid discount value required" });
    }

    const validFrom = parseDate(body.validFrom);
    const validTo = parseDate(body.validTo);
    if (!validFrom || !validTo) {
      return res.status(400).json({ success: false, message: "validFrom and validTo dates required" });
    }
    if (validFrom.getTime() > validTo.getTime()) {
      return res.status(400).json({ success: false, message: "validTo must be greater than or equal to validFrom" });
    }

    if (discountType === "PERCENTAGE" && value > 100) {
      return res.status(400).json({ success: false, message: "Percentage discount cannot exceed 100" });
    }

    const applyOn = norm(body.applyOn).toUpperCase() || "ORDER";
    const validApplyOn = DISCOUNT_APPLY_ON.includes(applyOn as typeof DISCOUNT_APPLY_ON[number]) ? applyOn : "ORDER";

    const applicableIds = Array.isArray(body.applicableIds)
      ? normalizeObjectIdArray(body.applicableIds)
      : [];

    if (validApplyOn !== "ORDER" && applicableIds.length === 0) {
      return res.status(400).json({ success: false, message: `Please select at least one ${validApplyOn.toLowerCase()} target` });
    }

    const applicableIdsAreValid = await validateApplicableIds(validApplyOn, applicableIds);
    if (!applicableIdsAreValid) {
      return res.status(400).json({ success: false, message: `Invalid ${validApplyOn.toLowerCase()} selection` });
    }

    const minOrderAmount = Number(body.minOrderAmount ?? 0);
    if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0) {
      return res.status(400).json({ success: false, message: "minOrderAmount must be a valid non-negative number" });
    }

    let maxDiscountAmount: number | null = null;
    if (body.maxDiscountAmount !== undefined && body.maxDiscountAmount !== null && norm(body.maxDiscountAmount) !== "") {
      const parsedMaxDiscountAmount = Number(body.maxDiscountAmount);

      if (!Number.isFinite(parsedMaxDiscountAmount) || parsedMaxDiscountAmount < 0) {
        return res.status(400).json({ success: false, message: "maxDiscountAmount must be a valid non-negative number" });
      }

      maxDiscountAmount = parsedMaxDiscountAmount;
    }

    const createdBy = buildCreatedBy(req);

    const doc = await DiscountModel.create({
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      code,
      description: norm(body.description),
      discountType,
      value,
      applyOn: validApplyOn,
      applicableIds: validApplyOn === "ORDER" ? [] : applicableIds,
      minOrderAmount,
      maxDiscountAmount,
      validFrom,
      validTo,
      createdBy,
    });

    const [data] = await resolveApplicableItems([doc.toObject() as DiscountResponseRow]);
    return res.status(201).json({ success: true, message: "Discount created successfully", data });
  } catch (error: unknown) {
    console.error("CREATE_DISCOUNT_ERROR:", error);
    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({ success: false, message: "Discount code already exists for this shop" });
    }
    return res.status(500).json({ success: false, message: "Failed to create discount" });
  }
}

export async function getDiscountById(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid discount id required" });

    const doc = await DiscountModel.findById(new mongoose.Types.ObjectId(id)).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Discount not found" });

    const [data] = await resolveApplicableItems([doc as DiscountResponseRow]);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("GET_DISCOUNT_BY_ID_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to get discount" });
  }
}

export async function updateDiscount(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid discount id required" });

    const body = getBody(req);
    const current = await DiscountModel.findById(new mongoose.Types.ObjectId(id)).lean();
    if (!current) return res.status(404).json({ success: false, message: "Discount not found" });

    const updates: Record<string, unknown> = {};

    if (body.code !== undefined) {
      const code = norm(body.code).toUpperCase();
      if (!code) return res.status(400).json({ success: false, message: "Discount code required" });
      updates.code = code;
    }

    if (body.description !== undefined) updates.description = norm(body.description);
    if (body.discountType !== undefined) {
      const discountType = norm(body.discountType).toUpperCase();
      if (!DISCOUNT_TYPE.includes(discountType as typeof DISCOUNT_TYPE[number])) {
        return res.status(400).json({ success: false, message: `discountType must be one of: ${DISCOUNT_TYPE.join(", ")}` });
      }
      updates.discountType = discountType;
    }
    if (body.value !== undefined) {
      const v = Number(body.value);
      if (!Number.isFinite(v) || v <= 0) {
        return res.status(400).json({ success: false, message: "Valid discount value required" });
      }

      const nextDiscountType = norm(updates.discountType || current.discountType).toUpperCase();
      if (nextDiscountType === "PERCENTAGE" && v > 100) {
        return res.status(400).json({ success: false, message: "Percentage discount cannot exceed 100" });
      }

      updates.value = v;
    }

    const nextApplyOnInput = body.applyOn !== undefined
      ? norm(body.applyOn).toUpperCase()
      : norm(current.applyOn).toUpperCase();
    const nextApplyOn = DISCOUNT_APPLY_ON.includes(nextApplyOnInput as typeof DISCOUNT_APPLY_ON[number])
      ? nextApplyOnInput
      : "ORDER";

    if (body.applyOn !== undefined) {
      updates.applyOn = nextApplyOn;
    }

    if (body.applicableIds !== undefined) {
      if (!Array.isArray(body.applicableIds)) {
        return res.status(400).json({ success: false, message: "applicableIds must be an array" });
      }

      const applicableIds = normalizeObjectIdArray(body.applicableIds);

      if (nextApplyOn !== "ORDER" && applicableIds.length === 0) {
        return res.status(400).json({ success: false, message: `Please select at least one ${nextApplyOn.toLowerCase()} target` });
      }

      const applicableIdsAreValid = await validateApplicableIds(nextApplyOn, applicableIds);
      if (!applicableIdsAreValid) {
        return res.status(400).json({ success: false, message: `Invalid ${nextApplyOn.toLowerCase()} selection` });
      }

      updates.applicableIds = nextApplyOn === "ORDER" ? [] : applicableIds;
    } else if (body.applyOn !== undefined && nextApplyOn === "ORDER") {
      updates.applicableIds = [];
    }

    if (body.minOrderAmount !== undefined) {
      const minOrderAmount = Number(body.minOrderAmount ?? 0);
      if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0) {
        return res.status(400).json({ success: false, message: "minOrderAmount must be a valid non-negative number" });
      }
      updates.minOrderAmount = minOrderAmount;
    }

    if (body.maxDiscountAmount !== undefined) {
      if (body.maxDiscountAmount === null || norm(body.maxDiscountAmount) === "") {
        updates.maxDiscountAmount = null;
      } else {
        const maxDiscountAmount = Number(body.maxDiscountAmount);
        if (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount < 0) {
          return res.status(400).json({ success: false, message: "maxDiscountAmount must be a valid non-negative number" });
        }
        updates.maxDiscountAmount = maxDiscountAmount;
      }
    }

    if (body.validFrom !== undefined) { const d = parseDate(body.validFrom); if (d) updates.validFrom = d; }
    if (body.validTo !== undefined) { const d = parseDate(body.validTo); if (d) updates.validTo = d; }
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);

    const nextValidFrom = updates.validFrom instanceof Date ? updates.validFrom : current.validFrom;
    const nextValidTo = updates.validTo instanceof Date ? updates.validTo : current.validTo;
    if (nextValidFrom instanceof Date && nextValidTo instanceof Date && nextValidFrom.getTime() > nextValidTo.getTime()) {
      return res.status(400).json({ success: false, message: "validTo must be greater than or equal to validFrom" });
    }

    const doc = await DiscountModel.findByIdAndUpdate(
      new mongoose.Types.ObjectId(id),
      { $set: updates },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Discount not found" });

    const [data] = await resolveApplicableItems([doc as DiscountResponseRow]);
    return res.status(200).json({ success: true, message: "Discount updated", data });
  } catch (error) {
    console.error("UPDATE_DISCOUNT_ERROR:", error);
    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({ success: false, message: "Discount code already exists for this shop" });
    }
    return res.status(500).json({ success: false, message: "Failed to update discount" });
  }
}

export async function deleteDiscount(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid discount id required" });

    const doc = await DiscountModel.findByIdAndUpdate(
      new mongoose.Types.ObjectId(id),
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Discount not found" });

    return res.status(200).json({ success: true, message: "Discount deleted" });
  } catch (error) {
    console.error("DELETE_DISCOUNT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to delete discount" });
  }
}

export async function validateDiscountCode(req: AuthedRequest, res: Response) {
  try {
    const shopId = getShopId(req);
    if (!shopId || !isObjId(shopId)) return res.status(400).json({ success: false, message: "Valid shopId required" });

    const code = norm(req.query?.code || getBody(req).code).toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: "Discount code required" });

    const now = new Date();
    const doc = await DiscountModel.findOne({
      shopId: new mongoose.Types.ObjectId(shopId),
      code,
      isActive: true,
      validFrom: { $lte: now },
      validTo: { $gte: now },
    }).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Invalid or expired discount code" });
    const [data] = await resolveApplicableItems([doc as DiscountResponseRow]);
    return res.status(200).json({ success: true, message: "Discount code is valid", data });
  } catch (error) {
    console.error("VALIDATE_DISCOUNT_CODE_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to validate discount code" });
  }
}
