export const PRODUCT_TYPE_FIELD_HEADINGS = [
  "Product Details",
  "Images",
  "Variations",
  "Offer",
  "Safety & Compliance",
] as const;

export const DEFAULT_PRODUCT_TYPE_FIELD_HEADING =
  PRODUCT_TYPE_FIELD_HEADINGS[0];

export function normalizeProductTypeFieldKey(value: unknown) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase();

  const words = cleaned.split(/\s+/).filter(Boolean);

  if (!words.length) {
    return "";
  }

  return words[0] + words.slice(1).map(capitalize).join("");
}

export function normalizeProductTypeFieldHeading(value: unknown) {
  const heading = String(value ?? "").trim();

  if (!heading) {
    return DEFAULT_PRODUCT_TYPE_FIELD_HEADING;
  }

  const matchedHeading = PRODUCT_TYPE_FIELD_HEADINGS.find(
    (item) => item.toLowerCase() === heading.toLowerCase()
  );

  return matchedHeading || heading;
}

export function getProductTypeFieldHeadingOrder(value: unknown) {
  const normalizedHeading = normalizeProductTypeFieldHeading(value);
  const index = PRODUCT_TYPE_FIELD_HEADINGS.findIndex(
    (item) => item === normalizedHeading
  );

  return index === -1 ? PRODUCT_TYPE_FIELD_HEADINGS.length : index;
}

export function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return uniqueTrimmedStrings(value);
  }

  if (typeof value === "string") {
    return uniqueTrimmedStrings(value.split(","));
  }

  return [];
}

export function hasMeaningfulDynamicValue(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function uniqueTrimmedStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
