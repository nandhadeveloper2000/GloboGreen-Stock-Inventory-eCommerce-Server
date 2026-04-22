import {
  PRODUCT_APPROVAL_STATUSES,
  PRODUCT_CONFIGURATION_MODES,
  type ProductApprovalStatus,
  type ProductConfigurationMode,
} from "./product.constants";

export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeRole(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeApprovalStatus(
  value: unknown
): ProductApprovalStatus {
  const normalized = normalizeRole(String(value ?? ""));

  if (
    PRODUCT_APPROVAL_STATUSES.includes(normalized as ProductApprovalStatus)
  ) {
    return normalized as ProductApprovalStatus;
  }

  return "PENDING";
}

export function normalizeConfigurationMode(
  value: unknown
): ProductConfigurationMode {
  const normalized = String(value ?? "").trim();

  if (
    PRODUCT_CONFIGURATION_MODES.includes(
      normalized as ProductConfigurationMode
    )
  ) {
    return normalized as ProductConfigurationMode;
  }

  return "variant";
}

export function uniqueCleanStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  );
}