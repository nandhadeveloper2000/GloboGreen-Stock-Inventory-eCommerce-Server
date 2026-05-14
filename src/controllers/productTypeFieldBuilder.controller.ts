import { Request, Response } from "express";
import mongoose from "mongoose";

import { CategoryModel } from "../models/category.model";
import {
  ProductTypeFieldBuilderModel,
  PRODUCT_TYPE_FIELD_BUILDER_INPUT_TYPES,
} from "../models/productTypeFieldBuilder.model";
import { ProductTypeModel } from "../models/productType.model";
import { SubCategoryModel } from "../models/subcategory.model";
import {
  getProductTypeFieldHeadingOrder,
  hasMeaningfulDynamicValue,
  normalizeProductTypeFieldHeading,
  normalizeProductTypeFieldKey,
  normalizeStringList,
} from "../utils/productTypeFields";

const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id ?? ""));

const norm = (value: unknown) => String(value ?? "").trim();

const allowedInputTypes = new Set(PRODUCT_TYPE_FIELD_BUILDER_INPUT_TYPES);
const optionDrivenInputTypes = new Set(["select", "multiSelect", "radio"]);

const builderPopulate = [
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
  _id?: mongoose.Types.ObjectId;
  label: string;
  key: string;
  inputType: (typeof PRODUCT_TYPE_FIELD_BUILDER_INPUT_TYPES)[number];
  placeholder: string;
  options?: string[];
  unitOptions?: string[];
  sortOrder: number;
  required: boolean;
  hasUnit: boolean;
  active: boolean;
};

type ParsedGroupDefinition = {
  _id?: mongoose.Types.ObjectId;
  groupName: string;
  sortOrder: number;
  isActive: boolean;
  fields: ParsedFieldDefinition[];
};

type ParsedSectionHeading = {
  _id?: mongoose.Types.ObjectId;
  headingName: string;
  sortOrder: number;
  isActive: boolean;
  groups: ParsedGroupDefinition[];
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

function parseObjectIdCandidate(value: unknown) {
  if (!isObjectId(value)) {
    return undefined;
  }

  return new mongoose.Types.ObjectId(String(value));
}

function normalizeSortOrder(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortFields(fields: ParsedFieldDefinition[]) {
  return [...fields].sort((a, b) => {
    const orderDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (orderDiff !== 0) return orderDiff;
    return a.label.localeCompare(b.label);
  });
}

function sortGroups(groups: ParsedGroupDefinition[]) {
  return [...groups].sort((a, b) => {
    const orderDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (orderDiff !== 0) return orderDiff;
    return a.groupName.localeCompare(b.groupName);
  });
}

function sortSections(sections: ParsedSectionHeading[]) {
  return [...sections].sort((a, b) => {
    const orderDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (orderDiff !== 0) return orderDiff;

    return (
      getProductTypeFieldHeadingOrder(a.headingName) -
      getProductTypeFieldHeadingOrder(b.headingName)
    );
  });
}

function hasMeaningfulFieldContent(field: any) {
  return Boolean(
    norm(field?.label) ||
      norm(field?.key) ||
      norm(field?.inputType) ||
      norm(field?.placeholder) ||
      normalizeStringList(field?.options).length ||
      normalizeStringList(field?.unitOptions).length ||
      field?.required !== undefined ||
      field?.hasUnit !== undefined ||
      field?.active !== undefined ||
      field?.isActive !== undefined ||
      field?.sortOrder !== undefined
  );
}

function sanitizeFieldDefinition(
  field: any,
  sectionIndex: number,
  groupIndex: number,
  fieldIndex: number,
  keyRegistry: Set<string>
):
  | { skip: true }
  | { error: string }
  | { value: ParsedFieldDefinition } {
  if (!hasMeaningfulFieldContent(field)) {
    return { skip: true };
  }

  const label = norm(field?.label);
  const key = normalizeProductTypeFieldKey(field?.key || label);
  const inputType = norm(field?.inputType) as ParsedFieldDefinition["inputType"];
  const options = normalizeStringList(field?.options);
  const unitOptions = normalizeStringList(field?.unitOptions);
  const hasUnit = parseBoolean(field?.hasUnit, false);
  const locationLabel = `section ${sectionIndex + 1}, group ${groupIndex + 1}, field ${fieldIndex + 1}`;

  if (!label) {
    return {
      error: `Field label is required for ${locationLabel}`,
    };
  }

  if (!key) {
    return {
      error: `Field key is required for "${label}"`,
    };
  }

  if (!allowedInputTypes.has(inputType)) {
    return {
      error: `Invalid inputType for "${label}"`,
    };
  }

  if (keyRegistry.has(key)) {
    return {
      error: `Duplicate field key "${key}" is not allowed inside the same Product Type`,
    };
  }

  if (optionDrivenInputTypes.has(inputType) && options.length === 0) {
    return {
      error: `Options are required for "${label}"`,
    };
  }

  if (hasUnit && unitOptions.length === 0) {
    return {
      error: `Unit options are required for "${label}"`,
    };
  }

  keyRegistry.add(key);

  return {
    value: {
      ...(parseObjectIdCandidate(field?._id) ? { _id: parseObjectIdCandidate(field?._id) } : {}),
      label,
      key,
      inputType,
      placeholder: norm(field?.placeholder),
      ...(optionDrivenInputTypes.has(inputType) && options.length > 0
        ? { options }
        : {}),
      ...(hasUnit && unitOptions.length > 0 ? { unitOptions } : {}),
      sortOrder: normalizeSortOrder(field?.sortOrder, fieldIndex + 1),
      required: parseBoolean(field?.required, false),
      hasUnit,
      active: parseBoolean(field?.active ?? field?.isActive, true),
    },
  };
}

function sanitizeGroupDefinition(
  group: any,
  sectionIndex: number,
  groupIndex: number,
  keyRegistry: Set<string>
):
  | { skip: true }
  | { error: string }
  | { value: ParsedGroupDefinition } {
  const rawFields = Array.isArray(group?.fields)
    ? group.fields
    : parseMaybeJson<any[]>(group?.fields, []);
  const groupName = norm(group?.groupName);
  const hasAnyFieldInput = rawFields.some((field: any) =>
    hasMeaningfulFieldContent(field)
  );

  if (!groupName && !hasAnyFieldInput) {
    return { skip: true };
  }

  if (!groupName) {
    return {
      error: `Group name is required for section ${sectionIndex + 1}, group ${groupIndex + 1}`,
    };
  }

  const parsedFields: ParsedFieldDefinition[] = [];

  for (let fieldIndex = 0; fieldIndex < rawFields.length; fieldIndex += 1) {
    const parsed = sanitizeFieldDefinition(
      rawFields[fieldIndex],
      sectionIndex,
      groupIndex,
      fieldIndex,
      keyRegistry
    );

    if ("error" in parsed) {
      return parsed;
    }

    if ("value" in parsed) {
      parsedFields.push(parsed.value);
    }
  }

  return {
    value: {
      ...(parseObjectIdCandidate(group?._id) ? { _id: parseObjectIdCandidate(group?._id) } : {}),
      groupName,
      sortOrder: normalizeSortOrder(group?.sortOrder, groupIndex + 1),
      isActive: parseBoolean(group?.isActive ?? group?.active, true),
      fields: sortFields(parsedFields),
    },
  };
}

function sanitizeSectionHeading(
  section: any,
  sectionIndex: number,
  keyRegistry: Set<string>
):
  | { skip: true }
  | { error: string }
  | { value: ParsedSectionHeading } {
  const rawGroups = Array.isArray(section?.groups)
    ? section.groups
    : parseMaybeJson<any[]>(section?.groups, []);
  const headingName = normalizeProductTypeFieldHeading(section?.headingName);
  const hasAnyGroupInput = rawGroups.some(
    (group: any) =>
      norm(group?.groupName) ||
      (Array.isArray(group?.fields) && group.fields.length)
  );

  if (!norm(section?.headingName) && !hasAnyGroupInput) {
    return { skip: true };
  }

  if (!headingName) {
    return {
      error: `Section heading name is required for section ${sectionIndex + 1}`,
    };
  }

  const parsedGroups: ParsedGroupDefinition[] = [];

  for (let groupIndex = 0; groupIndex < rawGroups.length; groupIndex += 1) {
    const parsed = sanitizeGroupDefinition(
      rawGroups[groupIndex],
      sectionIndex,
      groupIndex,
      keyRegistry
    );

    if ("error" in parsed) {
      return parsed;
    }

    if ("value" in parsed) {
      parsedGroups.push(parsed.value);
    }
  }

  return {
    value: {
      ...(parseObjectIdCandidate(section?._id)
        ? { _id: parseObjectIdCandidate(section?._id) }
        : {}),
      headingName,
      sortOrder: normalizeSortOrder(section?.sortOrder, sectionIndex + 1),
      isActive: parseBoolean(section?.isActive ?? section?.active, true),
      groups: sortGroups(parsedGroups),
    },
  };
}

function applyPopulate(query: any) {
  return builderPopulate.reduce(
    (current: any, option) => current.populate(option),
    query
  );
}

function buildResponseData(doc: any, includeInactive = true) {
  if (!doc) return null;

  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const sectionHeadings = Array.isArray(plain.sectionHeadings)
    ? plain.sectionHeadings
    : [];

  return {
    ...plain,
    sectionHeadings: sortSections(
      sectionHeadings
        .filter((section: any) => includeInactive || section?.isActive !== false)
        .map((section: any) => ({
          ...section,
          headingName: normalizeProductTypeFieldHeading(section?.headingName),
          groups: sortGroups(
            (Array.isArray(section?.groups) ? section.groups : [])
              .filter((group: any) => includeInactive || group?.isActive !== false)
              .map((group: any) => ({
                ...group,
                fields: sortFields(
                  (Array.isArray(group?.fields) ? group.fields : [])
                    .filter((field: any) => includeInactive || field?.active !== false)
                    .map((field: any, index: number) => ({
                      ...field,
                      key: normalizeProductTypeFieldKey(field?.key),
                      sortOrder: normalizeSortOrder(field?.sortOrder, index + 1),
                    }))
                ),
              }))
          ),
        }))
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

  const productTypeSubcategoryId = String(productType.subCategoryId || "");
  const subcategoryId = norm(input.subcategoryId) || productTypeSubcategoryId;

  if (!isObjectId(subcategoryId)) {
    return {
      ok: false as const,
      status: 400,
      message: "subcategoryId is required",
    };
  }

  const subcategory = await SubCategoryModel.findById(subcategoryId)
    .select("name categoryId")
    .lean();

  if (!subcategory) {
    return {
      ok: false as const,
      status: 404,
      message: "SubCategory not found",
    };
  }

  if (productTypeSubcategoryId && productTypeSubcategoryId !== subcategoryId) {
    return {
      ok: false as const,
      status: 400,
      message: "Selected Product Type does not belong to this SubCategory",
    };
  }

  const categoryId = norm(input.categoryId) || String(subcategory.categoryId || "");

  if (!isObjectId(categoryId)) {
    return {
      ok: false as const,
      status: 400,
      message: "categoryId is required",
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

  if (String(subcategory.categoryId || "") !== categoryId) {
    return {
      ok: false as const,
      status: 400,
      message: "Selected SubCategory does not belong to this Category",
    };
  }

  return {
    ok: true as const,
    data: {
      categoryId,
      subcategoryId,
      productTypeId: input.productTypeId,
    },
  };
}

async function buildBuilderPayload(
  body: any,
  options?: { existing?: any }
): Promise<
  | {
      ok: true;
      value: {
        categoryId: string;
        subcategoryId: string;
        productTypeId: string;
        sectionHeadings: ParsedSectionHeading[];
        isActive: boolean;
      };
    }
  | { ok: false; status: number; message: string }
> {
  const existing = options?.existing;
  const productTypeId = norm(body?.productTypeId || existing?.productTypeId);
  const categoryId = norm(body?.categoryId || existing?.categoryId);
  const subcategoryId = norm(body?.subcategoryId || existing?.subcategoryId);
  const isActive =
    body?.isActive !== undefined
      ? parseBoolean(body.isActive, true)
      : existing?.isActive !== false;
  const rawSections =
    body?.sectionHeadings !== undefined
      ? parseMaybeJson<any[]>(body.sectionHeadings, [])
      : Array.isArray(existing?.sectionHeadings)
        ? existing.sectionHeadings
        : [];

  if (!productTypeId) {
    return {
      ok: false,
      status: 400,
      message: "productTypeId is required",
    };
  }

  if (!categoryId) {
    return {
      ok: false,
      status: 400,
      message: "categoryId is required",
    };
  }

  if (!subcategoryId) {
    return {
      ok: false,
      status: 400,
      message: "subcategoryId is required",
    };
  }

  if (!Array.isArray(rawSections)) {
    return {
      ok: false,
      status: 400,
      message: "sectionHeadings must be an array",
    };
  }

  const keyRegistry = new Set<string>();
  const parsedSections: ParsedSectionHeading[] = [];

  for (let sectionIndex = 0; sectionIndex < rawSections.length; sectionIndex += 1) {
    const parsed = sanitizeSectionHeading(
      rawSections[sectionIndex],
      sectionIndex,
      keyRegistry
    );

    if ("error" in parsed) {
      return {
        ok: false,
        status: 400,
        message: parsed.error,
      };
    }

    if ("value" in parsed) {
      parsedSections.push(parsed.value);
    }
  }

  const resolvedContext = await resolveReferenceContext({
    productTypeId,
    categoryId,
    subcategoryId,
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
      categoryId: resolvedContext.data.categoryId,
      subcategoryId: resolvedContext.data.subcategoryId,
      productTypeId: resolvedContext.data.productTypeId,
      sectionHeadings: sortSections(parsedSections),
      isActive,
    },
  };
}

function flattenBuilderSearchText(doc: any) {
  const sectionHeadings = Array.isArray(doc?.sectionHeadings) ? doc.sectionHeadings : [];

  return sectionHeadings
    .flatMap((section: any) => [
      norm(section?.headingName),
      ...(Array.isArray(section?.groups)
        ? section.groups.flatMap((group: any) => [
            norm(group?.groupName),
            ...(Array.isArray(group?.fields)
              ? group.fields.flatMap((field: any) => [
                  norm(field?.label),
                  norm(field?.key),
                  norm(field?.inputType),
                  ...(Array.isArray(field?.options) ? field.options : []),
                  ...(Array.isArray(field?.unitOptions) ? field.unitOptions : []),
                ])
              : []),
          ])
        : []),
    ])
    .filter(hasMeaningfulDynamicValue)
    .join(" ")
    .toLowerCase();
}

export async function createOrUpdateProductTypeFieldBuilder(
  req: Request,
  res: Response
) {
  try {
    const payload = await buildBuilderPayload(req.body);

    if (!payload.ok) {
      return res.status(payload.status).json({
        success: false,
        message: payload.message,
      });
    }

    let builder = await ProductTypeFieldBuilderModel.findOne({
      productTypeId: payload.value.productTypeId,
    });
    const existed = Boolean(builder);

    if (builder) {
      builder.set(payload.value);
      await builder.save();
    } else {
      builder = await ProductTypeFieldBuilderModel.create(payload.value);
    }

    const populated = await applyPopulate(
      ProductTypeFieldBuilderModel.findById(builder._id)
    );

    return res.status(existed ? 200 : 201).json({
      success: true,
      message: "Product Type Field Builder saved successfully",
      data: buildResponseData(populated),
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A field builder already exists for this Product Type",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to save Product Type Field Builder",
    });
  }
}

export async function listProductTypeFieldBuilders(
  req: Request,
  res: Response
) {
  try {
    const q = norm(req.query?.q).toLowerCase();
    const isActive = req.query?.isActive;
    const productTypeId = norm(req.query?.productTypeId);
    const categoryId = norm(req.query?.categoryId);
    const subcategoryId = norm(req.query?.subcategoryId);

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

    if (categoryId) {
      if (!isObjectId(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid categoryId",
        });
      }

      filter.categoryId = categoryId;
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

    if (isActive !== undefined) {
      filter.isActive = parseBoolean(isActive, true);
    }

    const docs = await applyPopulate(
      ProductTypeFieldBuilderModel.find(filter).sort({
        updatedAt: -1,
        createdAt: -1,
      })
    );

    const rows = docs
      .map((doc: any) => buildResponseData(doc))
      .filter((doc: any) => {
        if (!q) return true;

        const productTypeName = norm(doc?.productTypeId?.name).toLowerCase();
        const subcategoryName = norm(doc?.subcategoryId?.name).toLowerCase();
        const categoryName = norm(
          doc?.categoryId?.name || doc?.subcategoryId?.categoryId?.name
        ).toLowerCase();
        const structureText = flattenBuilderSearchText(doc);

        return [productTypeName, subcategoryName, categoryName, structureText]
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
      message: error?.message || "Failed to fetch Product Type Field Builders",
    });
  }
}

export async function getProductTypeFieldBuilderByProductType(
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

    const doc = await applyPopulate(ProductTypeFieldBuilderModel.findOne(filter));

    return res.json({
      success: true,
      data: buildResponseData(doc, includeInactive),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message:
        error?.message || "Failed to fetch Product Type Field Builder",
    });
  }
}

export async function updateProductTypeFieldBuilder(
  req: Request,
  res: Response
) {
  try {
    const productTypeId = norm(req.params?.productTypeId);

    if (!isObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productTypeId",
      });
    }

    const existing = await ProductTypeFieldBuilderModel.findOne({
      productTypeId,
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product Type Field Builder not found",
      });
    }

    const payload = await buildBuilderPayload(
      {
        ...req.body,
        productTypeId,
      },
      { existing }
    );

    if (!payload.ok) {
      return res.status(payload.status).json({
        success: false,
        message: payload.message,
      });
    }

    existing.set(payload.value);
    await existing.save();

    const populated = await applyPopulate(
      ProductTypeFieldBuilderModel.findById(existing._id)
    );

    return res.json({
      success: true,
      message: "Product Type Field Builder updated successfully",
      data: buildResponseData(populated),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message:
        error?.message || "Failed to update Product Type Field Builder",
    });
  }
}

export async function deleteProductTypeFieldBuilder(
  req: Request,
  res: Response
) {
  try {
    const productTypeId = norm(req.params?.productTypeId);

    if (!isObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productTypeId",
      });
    }

    const existing = await ProductTypeFieldBuilderModel.findOne({
      productTypeId,
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product Type Field Builder not found",
      });
    }

    existing.isActive = false;
    await existing.save();

    return res.json({
      success: true,
      message: "Product Type Field Builder deactivated successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message:
        error?.message || "Failed to deactivate Product Type Field Builder",
    });
  }
}

export async function toggleProductTypeFieldBuilderStatus(
  req: Request,
  res: Response
) {
  try {
    const productTypeId = norm(req.params?.productTypeId);

    if (!isObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productTypeId",
      });
    }

    const existing = await ProductTypeFieldBuilderModel.findOne({
      productTypeId,
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product Type Field Builder not found",
      });
    }

    existing.isActive =
      req.body?.isActive !== undefined
        ? parseBoolean(req.body.isActive, existing.isActive)
        : !existing.isActive;

    await existing.save();

    const populated = await applyPopulate(
      ProductTypeFieldBuilderModel.findById(existing._id)
    );

    return res.json({
      success: true,
      message: `Product Type Field Builder ${
        existing.isActive ? "activated" : "deactivated"
      } successfully`,
      data: buildResponseData(populated),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message:
        error?.message || "Failed to update Product Type Field Builder status",
    });
  }
}
