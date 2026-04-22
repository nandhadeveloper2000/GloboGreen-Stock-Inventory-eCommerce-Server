export const PRODUCT_APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

export const PRODUCT_CONFIGURATION_MODES = [
  "variant",
  "variantCompatibility",
  "productMediaInfoCompatibility",
  "productMediaInfo",
] as const;

export type ProductApprovalStatus =
  (typeof PRODUCT_APPROVAL_STATUSES)[number];

export type ProductConfigurationMode =
  (typeof PRODUCT_CONFIGURATION_MODES)[number];