import { Request, Response } from "express";
import mongoose from "mongoose";

import { CategoryModel } from "../models/category.model";
import {
  ProductTypeFieldModel,
  PRODUCT_TYPE_FIELD_INPUT_TYPES,
} from "../models/productTypeField.model";
import { ProductTypeModel } from "../models/productType.model";
import { SubCategoryModel } from "../models/subcategory.model";
import {
  hasMeaningfulDynamicValue,
  normalizeProductTypeFieldHeading,
  normalizeProductTypeFieldKey,
  normalizeStringList,
} from "../utils/productTypeFields";

const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id ?? ""));

const norm = (value: unknown) => String(value ?? "").trim();

const allowedInputTypes = new Set(PRODUCT_TYPE_FIELD_INPUT_TYPES);

const productTypeFieldPopulate = [
  {
    path: "categoryId",
    select: "name nameKey isActive",
  },
  {
    path: "subcategoryId",
    select: "name nameKey isActive categoryId",
    populate: {
      path: "categoryId",
      select: "name nameKey isActive",
    },
  },
  {
    path: "productTypeId",
    select: "name nameKey isActive subCategoryId",
    populate: {
      path: "subCategoryId",
      select: "name nameKey isActive categoryId",
      populate: {
        path: "categoryId",
        select: "name nameKey isActive",
      },
    },
  },
] as const;

type ParsedFieldDefinition = {
  key: string;
  label: string;
  inputType: (typeof PRODUCT_TYPE_FIELD_INPUT_TYPES)[number];
  required: boolean;
  addMore: boolean;
  placeholder: string;
  options?: string[];
  hasUnit: boolean;
  unitOptions?: string[];
  sortOrder: number;
  isActive: boolean;
};

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseMaybeJson<T>(value: unknown, fallback: T) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseSortOrder(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function sortFields<T extends { sortOrder?: number; label?: string }>(fields: T[]) {
  return [...fields].sort((a, b) => {
    const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (sortDiff !== 0) return sortDiff;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });
}

function sanitizeFieldDefinition(
  field: any,
  index: number,
  localKeys: Set<string>
): { value?: ParsedFieldDefinition; error?: string } {
  const label = norm(field?.label);
  const normalizedKey = normalizeProductTypeFieldKey(field?.key || label);
  const inputType = norm(field?.inputType) as ParsedFieldDefinition["inputType"];
  const options = normalizeStringList(field?.options);
  const unitOptions = normalizeStringList(field?.unitOptions);

  if (!label) {
    return {
      error: `Field label is required for row ${index + 1}`,
    };
  }

  if (!normalizedKey) {
    return {
      error: `Field key is required for row ${index + 1}`,
    };
  }

  if (localKeys.has(normalizedKey)) {
    return {
      error: `Duplicate field key "${normalizedKey}" found in this group`,
    };
  }

  if (!allowedInputTypes.has(inputType)) {
    return {
      error: `Invalid inputType for field "${label}"`,
    };
  }

  if (inputType === "select" && options.length === 0) {
    return {
      error: `Options are required for select field "${label}"`,
    };
  }

  const hasUnit = parseBoolean(field?.hasUnit, false);

  if (hasUnit && unitOptions.length === 0) {
    return {
      error: `Unit options are required for field "${label}"`,
    };
  }

  localKeys.add(normalizedKey);

  return {
    value: {
      key: normalizedKey,
      label,
      inputType,
      required: parseBoolean(field?.required, false),
      addMore: parseBoolean(field?.addMore, false),
      placeholder: norm(field?.placeholder),
      ...(inputType === "select" && options.length > 0
        ? { options }
        : {}),
      hasUnit,
      ...(hasUnit && unitOptions.length > 0 ? { unitOptions } : {}),
      sortOrder: parseSortOrder(field?.sortOrder),
      isActive: parseBoolean(field?.isActive, true),
    },
  };
}

function applyPopulate(query: any) {
  return productTypeFieldPopulate.reduce(
    (current: any, option) => current.populate(option),
    query
  );
}

function buildResponseData(doc: any, includeInactiveFields = true) {
  if (!doc) return doc;

  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const fields = Array.isArray(plain.fields) ? plain.fields : [];

  return {
    ...plain,
    headingName: normalizeProductTypeFieldHeading(plain.headingName),
    fields: sortFields(
      includeInactiveFields
        ? fields
        : fields.filter((field: any) => field?.isActive !== false)
    ),
  };
}

async function resolveReferenceContext(input: {
  productTypeId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
}) {
  const productType = await ProductTypeModel.findById(input.productTypeId)
    .select("name subCategoryId")
    .lean();

  if (!productType) {
    return {
      ok: false as const,
      status: 404,
      message: "Product Type not found",
    };
  }

  const productTypeSubCategoryId = String(productType.subCategoryId || "");

  const subCategoryId = norm(input.subcategoryId) || productTypeSubCategoryId;

  if (!isObjectId(subCategoryId)) {
    return {
      ok: false as const,
      status: 400,
      message: "Invalid subcategoryId",
    };
  }

  const subCategory = await SubCategoryModel.findById(subCategoryId)
    .select("name categoryId")
    .lean();

  if (!subCategory) {
    return {
      ok: false as const,
      status: 404,
      message: "SubCategory not found",
    };
  }

  if (productTypeSubCategoryId && productTypeSubCategoryId !== subCategoryId) {
    return {
      ok: false as const,
      status: 400,
      message: "Selected Product Type does not belong to this SubCategory",
    };
  }

  const categoryId = norm(input.categoryId) || String(subCategory.categoryId || "");

  if (!isObjectId(categoryId)) {
    return {
      ok: false as const,
      status: 400,
      message: "Invalid categoryId",
    };
  }

  const category = await CategoryModel.findById(categoryId)
    .select("name")
    .lean();

  if (!category) {
    return {
      ok: false as const,
      status: 404,
      message: "Category not found",
    };
  }

  if (String(subCategory.categoryId || "") !== categoryId) {
    return {
      ok: false as const,
      status: 400,
      message: "Selected SubCategory does not belong to this Category",
    };
  }

  return {
    ok: true as const,
    status: 200,
    data: {
      productTypeId: input.productTypeId,
      subcategoryId: subCategoryId,
      categoryId,
    },
  };
}

async function ensureUniqueKeysForProductType(params: {
  productTypeId: string;
  keys: string[];
  excludeId?: string;
}) {
  const filter: Record<string, unknown> = {
    productTypeId: params.productTypeId,
  };

  if (params.excludeId && isObjectId(params.excludeId)) {
    filter._id = { $ne: new mongoose.Types.ObjectId(params.excludeId) };
  }

  const docs = await ProductTypeFieldModel.find(filter).select("fields").lean();

  const existingKeys = new Set(
    docs.flatMap((doc) =>
      Array.isArray(doc.fields)
        ? doc.fields
            .map((field: any) => normalizeProductTypeFieldKey(field?.key))
            .filter(Boolean)
        : []
    )
  );

  const duplicateKey = params.keys.find((key) => existingKeys.has(key));

  if (!duplicateKey) {
    return null;
  }

  return duplicateKey;
}

async function buildGroupPayload(
  body: any,
  options?: { existing?: any }
): Promise<
  | {
      ok: true;
      value: {
        productTypeId: string;
        categoryId: string;
        subcategoryId: string;
        headingName: string;
        groupName: string;
        fields: ParsedFieldDefinition[];
        isActive: boolean;
      };
    }
  | { ok: false; status: number; message: string }
> {
  const existing = options?.existing;

  const productTypeId = norm(body?.productTypeId || existing?.productTypeId);
  const headingName = normalizeProductTypeFieldHeading(
    body?.headingName || existing?.headingName
  );
  const groupName = norm(body?.groupName || existing?.groupName);
  const rawFields =
    body?.fields !== undefined
      ? parseMaybeJson<any[]>(body.fields, [])
      : Array.isArray(existing?.fields)
        ? existing.fields
        : [];
  const isActive =
    body?.isActive !== undefined
      ? parseBoolean(body.isActive, true)
      : existing?.isActive !== false;

  if (!productTypeId) {
    return {
      ok: false,
      status: 400,
      message: "productTypeId is required",
    };
  }

  if (!isObjectId(productTypeId)) {
    return {
      ok: false,
      status: 400,
      message: "Invalid productTypeId",
    };
  }

  if (!groupName) {
    return {
      ok: false,
      status: 400,
      message: "groupName is required",
    };
  }

  if (!Array.isArray(rawFields)) {
    return {
      ok: false,
      status: 400,
      message: "fields must be an array",
    };
  }

  if (rawFields.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "At least one field is required",
    };
  }

  const localKeys = new Set<string>();
  const parsedFields: ParsedFieldDefinition[] = [];

  for (let index = 0; index < rawFields.length; index += 1) {
    const parsed = sanitizeFieldDefinition(rawFields[index], index, localKeys);

    if (!parsed.value) {
      return {
        ok: false,
        status: 400,
        message: parsed.error || "Invalid field definition",
      };
    }

    parsedFields.push(parsed.value);
  }

  const duplicateKey = await ensureUniqueKeysForProductType({
    productTypeId,
    keys: parsedFields.map((field) => field.key),
    excludeId: existing?._id ? String(existing._id) : undefined,
  });

  if (duplicateKey) {
    return {
      ok: false,
      status: 409,
      message: `Field key "${duplicateKey}" already exists for this Product Type`,
    };
  }

  const resolvedContext = await resolveReferenceContext({
    productTypeId,
    categoryId: norm(body?.categoryId || existing?.categoryId) || null,
    subcategoryId: norm(body?.subcategoryId || existing?.subcategoryId) || null,
  });

  if (!resolvedContext.ok) {
    return {
      ok: false,
      status: resolvedContext.status,
      message: resolvedContext.message,
    };
  }

  return {
    ok: true,
    value: {
      productTypeId: resolvedContext.data.productTypeId,
      categoryId: resolvedContext.data.categoryId,
      subcategoryId: resolvedContext.data.subcategoryId,
      headingName,
      groupName,
      fields: sortFields(parsedFields),
      isActive,
    },
  };
}

export async function createProductTypeFields(req: Request, res: Response) {
  try {
    const payload = await buildGroupPayload(req.body);

    if (!payload.ok) {
      return res.status(payload.status).json({
        success: false,
        message: payload.message,
      });
    }

    const doc = await ProductTypeFieldModel.create(payload.value);
    const populated = await applyPopulate(ProductTypeFieldModel.findById(doc._id));

    return res.status(201).json({
      success: true,
      message: "Product Type Fields created successfully",
      data: buildResponseData(populated),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create Product Type Fields",
    });
  }
}

export async function getProductTypeFields(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q).toLowerCase();
    const productTypeId = norm(req.query?.productTypeId);
    const subcategoryId = norm(req.query?.subcategoryId);
    const categoryId = norm(req.query?.categoryId);
    const isActive = req.query?.isActive;

    const filter: Record<string, unknown> = {};

    if (productTypeId) {
      if (!isObjectId(productTypeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid productTypeId",
        });
      }

      filter.productTypeId = productTypeId;
    }

    if (subcategoryId) {
      if (!isObjectId(subcategoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid subcategoryId",
        });
      }

      filter.subcategoryId = subcategoryId;
    }

    if (categoryId) {
      if (!isObjectId(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid categoryId",
        });
      }

      filter.categoryId = categoryId;
    }

    if (isActive !== undefined) {
      filter.isActive = parseBoolean(isActive, true);
    }

    const docs = await applyPopulate(
      ProductTypeFieldModel.find(filter).sort({
        updatedAt: -1,
        createdAt: -1,
      })
    );

    const rows = docs
      .map((doc: any) => buildResponseData(doc))
      .filter((doc: any) => {
        if (!q) return true;

        const productTypeName = norm(doc?.productTypeId?.name).toLowerCase();
        const subCategoryName = norm(doc?.subcategoryId?.name).toLowerCase();
        const categoryName = norm(
          doc?.categoryId?.name || doc?.subcategoryId?.categoryId?.name
        ).toLowerCase();
        const headingName = norm(doc?.headingName).toLowerCase();
        const groupName = norm(doc?.groupName).toLowerCase();
        const fieldText = Array.isArray(doc?.fields)
          ? doc.fields
              .map((field: any) =>
                [
                  norm(field?.label),
                  norm(field?.key),
                  norm(field?.inputType),
                  ...(Array.isArray(field?.options) ? field.options : []),
                  ...(Array.isArray(field?.unitOptions) ? field.unitOptions : []),
                ]
                  .filter(hasMeaningfulDynamicValue)
                  .join(" ")
              )
              .join(" ")
              .toLowerCase()
          : "";

        return [
          productTypeName,
          subCategoryName,
          categoryName,
          headingName,
          groupName,
          fieldText,
        ]
          .filter(Boolean)
          .some((value) => value.includes(q));
      });

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Product Type Fields",
    });
  }
}

export async function getProductTypeFieldsByProductType(
  req: Request,
  res: Response
) {
  try {
    const productTypeId = norm(req.params?.productTypeId);
    const includeInactive =
      String(req.query?.includeInactive || "").trim().toLowerCase() === "true";

    if (!isObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productTypeId",
      });
    }

    const filter: Record<string, unknown> = {
      productTypeId,
    };

    if (!includeInactive) {
      filter.isActive = true;
    }

    const docs = await applyPopulate(
      ProductTypeFieldModel.find(filter).sort({
        updatedAt: -1,
        createdAt: -1,
      })
    );

    return res.json({
      success: true,
      data: docs
        .map((doc: any) => buildResponseData(doc, includeInactive))
        .filter(
          (doc: any) => includeInactive || (doc.fields || []).length > 0
        ),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message:
        error?.message || "Failed to fetch Product Type Fields by Product Type",
    });
  }
}

export async function updateProductTypeFields(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const existing = await ProductTypeFieldModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product Type Fields not found",
      });
    }

    const payload = await buildGroupPayload(req.body, { existing });

    if (!payload.ok) {
      return res.status(payload.status).json({
        success: false,
        message: payload.message,
      });
    }

    existing.productTypeId = new mongoose.Types.ObjectId(payload.value.productTypeId);
    existing.categoryId = new mongoose.Types.ObjectId(payload.value.categoryId);
    existing.subcategoryId = new mongoose.Types.ObjectId(
      payload.value.subcategoryId
    );
    existing.headingName = payload.value.headingName;
    existing.groupName = payload.value.groupName;
    existing.fields = payload.value.fields as any;
    existing.isActive = payload.value.isActive;

    await existing.save();

    const populated = await applyPopulate(ProductTypeFieldModel.findById(existing._id));

    return res.json({
      success: true,
      message: "Product Type Fields updated successfully",
      data: buildResponseData(populated),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Product Type Fields",
    });
  }
}

export async function deleteProductTypeFields(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const deleted = await ProductTypeFieldModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Product Type Fields not found",
      });
    }

    return res.json({
      success: true,
      message: "Product Type Fields deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete Product Type Fields",
    });
  }
}

export async function toggleProductTypeFieldStatus(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const existing = await ProductTypeFieldModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product Type Fields not found",
      });
    }

    const nextStatus =
      req.body?.isActive !== undefined
        ? parseBoolean(req.body.isActive, existing.isActive)
        : !existing.isActive;

    existing.isActive = nextStatus;
    await existing.save();

    const populated = await applyPopulate(ProductTypeFieldModel.findById(existing._id));

    return res.json({
      success: true,
      message: `Product Type Fields ${
        nextStatus ? "activated" : "deactivated"
      } successfully`,
      data: buildResponseData(populated),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Product Type Fields status",
    });
  }
}
