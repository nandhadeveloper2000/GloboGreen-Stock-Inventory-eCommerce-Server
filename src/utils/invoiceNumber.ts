import mongoose from "mongoose";
import { ShopModel } from "../models/shop.model";

function digitsOnly(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeSeriesCode(value: string) {
  const cleaned = value.replace(/[^A-Z0-9]/gi, "").toUpperCase();

  if (!cleaned) return "0000";
  if (cleaned.length >= 4) return cleaned.slice(-4);

  return cleaned.padStart(4, "0");
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractInvoiceSequence(invoiceNo: unknown, prefix: string) {
  const value = String(invoiceNo || "").trim().toUpperCase();
  const normalizedPrefix = prefix.toUpperCase();

  if (!value.startsWith(`${normalizedPrefix}-`)) {
    return 0;
  }

  const sequence = Number(value.slice(normalizedPrefix.length + 1));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

export async function resolveInvoiceSeriesCode(
  shopId: string,
  session?: mongoose.ClientSession
) {
  if (!mongoose.Types.ObjectId.isValid(shopId)) {
    return "0000";
  }

  const shop = await ShopModel.findById(shopId)
    .select("mobile gstNumber name")
    .session(session || null);

  const mobileDigits = digitsOnly(shop?.mobile);
  if (mobileDigits.length >= 4) {
    return mobileDigits.slice(-4);
  }

  const gstDigits = digitsOnly(shop?.gstNumber);
  if (gstDigits.length >= 4) {
    return gstDigits.slice(-4);
  }

  const nameCode = normalizeSeriesCode(String(shop?.name || ""));
  if (nameCode !== "0000") {
    return nameCode;
  }

  return normalizeSeriesCode(shopId);
}

export async function buildNextInvoiceNumber(
  shopId: string,
  loadInvoiceNumbers: (
    prefix: string,
    matcher: RegExp
  ) => Promise<Array<string | null | undefined>>,
  session?: mongoose.ClientSession
) {
  const seriesCode = await resolveInvoiceSeriesCode(shopId, session);
  const prefix = `INV${seriesCode}`;
  const matcher = new RegExp(`^${escapeRegex(prefix)}-\\d{3}$`, "i");
  const existingValues = await loadInvoiceNumbers(prefix, matcher);

  const nextSequence = existingValues.reduce((max, value) => {
    return Math.max(max, extractInvoiceSequence(value, prefix));
  }, 0);

  return `${prefix}-${String(nextSequence + 1).padStart(3, "0")}`;
}
