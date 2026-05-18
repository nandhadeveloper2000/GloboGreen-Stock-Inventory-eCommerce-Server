import { z } from "zod";
import { zObjectId, zMobile, zPincode, zGst, zNonEmptyString, zPositiveNumber, zNonNegativeNumber } from "../middlewares/validate";

// ─── Auth ────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  login: z.string().trim().min(1, "Login is required"),
  pin: z.string().trim().min(4, "PIN must be at least 4 characters").max(20),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(1, "refreshToken is required"),
});

export const ForgotPinSchema = z.object({
  email: z.string().trim().email("Valid email required"),
});

export const VerifyOtpSchema = z.object({
  email: z.string().trim().email("Valid email required"),
  otp: z.string().trim().min(4).max(10),
});

export const ResetPinSchema = z.object({
  email: z.string().trim().email("Valid email required"),
  otp: z.string().trim().min(4).max(10),
  newPin: z.string().trim().min(4, "PIN must be at least 4 characters").max(20),
});

export const ChangePinSchema = z.object({
  currentPin: z.string().trim().min(1, "Current PIN is required"),
  newPin: z
    .string()
    .trim()
    .min(4, "New PIN must be at least 4 characters")
    .max(20),
});

// ─── Common Address ──────────────────────────────────────────────────────────

export const AddressSchema = z.object({
  state: z.string().trim().min(1, "State is required"),
  district: z.string().trim().min(1).optional(),
  taluk: z.string().trim().optional(),
  area: z.string().trim().optional(),
  street: z.string().trim().optional(),
  pincode: zPincode.optional(),
});

// ─── Shop Owner ──────────────────────────────────────────────────────────────

export const CreateShopOwnerSchema = z.object({
  name: zNonEmptyString,
  email: z.string().trim().email("Valid email required"),
  mobile: zMobile,
  pin: z.string().trim().min(4).max(20),
  address: AddressSchema.optional(),
});

export const UpdateShopOwnerSchema = z.object({
  name: z.string().trim().min(1).optional(),
  mobile: zMobile.optional(),
  address: AddressSchema.optional(),
});

// ─── Shop ─────────────────────────────────────────────────────────────────────

export const CreateShopSchema = z.object({
  shopName: zNonEmptyString,
  name: z.string().trim().optional(),
  mobile: zMobile,
  shopType: z.enum(
    [
      "WAREHOUSE_RETAIL_SHOP",
      "RETAIL_BRANCH_SHOP",
      "WHOLESALE_SHOP",
      "MAIN",
      "BRANCH",
    ] as const,
    { error: "shopType is required" }
  ),
  billingType: z.enum(["GST", "NON_GST"]).default("GST"),
  businessType: z.enum(["Retail", "Wholesale"]).optional(),
  gstNumber: zGst,
  enableGSTBilling: z.boolean().optional(),
  isMainWarehouse: z.boolean().optional(),
  ownerId: zObjectId.optional(),
  shopOwnerAccountId: zObjectId.optional(),
  state: z.string().trim().optional(),
  district: z.string().trim().optional(),
  taluk: z.string().trim().optional(),
  area: z.string().trim().optional(),
  street: z.string().trim().optional(),
  pincode: zPincode.optional(),
});

export const UpdateShopSchema = CreateShopSchema.partial().omit({ ownerId: true });

// ─── Vendor ───────────────────────────────────────────────────────────────────

export const CreateVendorSchema = z.object({
  name: zNonEmptyString,
  mobile: zMobile.optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  gstNumber: zGst,
  shopId: zObjectId,
  address: AddressSchema.optional(),
  contactPerson: z.string().trim().optional(),
  bankName: z.string().trim().optional(),
  accountNumber: z.string().trim().optional(),
  ifscCode: z.string().trim().optional(),
});

export const UpdateVendorSchema = CreateVendorSchema.partial();

// ─── Product ──────────────────────────────────────────────────────────────────

export const CreateProductSchema = z.object({
  name: zNonEmptyString,
  sku: z.string().trim().optional(),
  categoryId: zObjectId,
  subcategoryId: zObjectId.optional(),
  brandId: zObjectId.optional(),
  modelId: zObjectId.optional(),
  productTypeId: zObjectId.optional(),
  description: z.string().trim().optional(),
  mrp: zPositiveNumber.optional(),
  sellingPrice: zNonNegativeNumber.optional(),
  purchasePrice: zNonNegativeNumber.optional(),
  taxRate: zNonNegativeNumber.optional(),
  unit: z.string().trim().optional(),
  hsnCode: z.string().trim().optional(),
});

// ─── Purchase ─────────────────────────────────────────────────────────────────

export const PurchaseItemSchema = z.object({
  productId: zObjectId,
  variantId: zObjectId.optional(),
  qty: z.number().int().positive("Quantity must be a positive integer"),
  purchasePrice: zNonNegativeNumber,
  mrp: zNonNegativeNumber.optional(),
  taxRate: zNonNegativeNumber.optional(),
  discount: zNonNegativeNumber.optional(),
  batchNo: z.string().trim().optional(),
  expiryDate: z.string().trim().optional(),
  serialNumbers: z.array(z.string().trim()).optional(),
});

export const CreatePurchaseSchema = z.object({
  shopId: zObjectId,
  vendorId: zObjectId.optional(),
  items: z.array(PurchaseItemSchema).min(1, "At least one item required"),
  purchaseDate: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  paymentMode: z.enum(["CASH", "CREDIT", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  paidAmount: zNonNegativeNumber.optional(),
});

// ─── Sales ───────────────────────────────────────────────────────────────────

export const SaleItemSchema = z.object({
  productId: zObjectId,
  variantId: zObjectId.optional(),
  qty: z.number().int().positive("Quantity must be a positive integer"),
  sellingPrice: zNonNegativeNumber,
  discount: zNonNegativeNumber.optional(),
  taxRate: zNonNegativeNumber.optional(),
  serialNumbers: z.array(z.string().trim()).optional(),
});

export const CreateSaleSchema = z.object({
  shopId: zObjectId,
  customerId: zObjectId.optional(),
  items: z.array(SaleItemSchema).min(1, "At least one item required"),
  saleDate: z.string().trim().optional(),
  paymentMode: z.enum(["CASH", "CREDIT", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  paidAmount: zNonNegativeNumber.optional(),
  discountAmount: zNonNegativeNumber.optional(),
  notes: z.string().trim().optional(),
});

// ─── Stock Transfer ───────────────────────────────────────────────────────────

export const StockTransferItemSchema = z.object({
  productId: zObjectId,
  variantId: zObjectId.optional(),
  qty: z.number().int().positive("Quantity must be a positive integer"),
});

export const CreateStockTransferSchema = z.object({
  sourceShopId: zObjectId,
  destinationShopId: zObjectId,
  items: z.array(StockTransferItemSchema).min(1, "At least one item required"),
  notes: z.string().trim().optional(),
  transferDate: z.string().trim().optional(),
}).refine(
  (data) => data.sourceShopId !== data.destinationShopId,
  { message: "Source and destination shops must be different" }
);

// ─── Expense ──────────────────────────────────────────────────────────────────

export const CreateExpenseSchema = z.object({
  shopId: zObjectId,
  categoryId: zObjectId.optional(),
  amount: zPositiveNumber,
  description: zNonEmptyString,
  expenseDate: z.string().trim().optional(),
  paymentMode: z.enum(["CASH", "CREDIT", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  notes: z.string().trim().optional(),
});

// ─── Payment ──────────────────────────────────────────────────────────────────

export const CreatePaymentSchema = z.object({
  shopId: zObjectId,
  partyType: z.enum(["CUSTOMER", "VENDOR"]),
  partyId: zObjectId,
  amount: zPositiveNumber,
  paymentMode: z.enum(["CASH", "CREDIT", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  notes: z.string().trim().optional(),
  paymentDate: z.string().trim().optional(),
});

// ─── Discount ─────────────────────────────────────────────────────────────────

export const CreateDiscountSchema = z.object({
  shopId: zObjectId,
  name: zNonEmptyString,
  discountType: z.enum(["PERCENTAGE", "FLAT"]),
  value: zPositiveNumber,
  minOrderAmount: zNonNegativeNumber.optional(),
  maxDiscountAmount: zNonNegativeNumber.optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

// ─── Customer ────────────────────────────────────────────────────────────────

export const CreateCustomerSchema = z.object({
  name: zNonEmptyString,
  mobile: zMobile.optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  shopId: zObjectId.optional(),
  address: AddressSchema.optional(),
  gstNumber: zGst,
});

// ─── Category / Subcategory ───────────────────────────────────────────────────

export const CreateCategorySchema = z.object({
  name: zNonEmptyString,
  description: z.string().trim().optional(),
  shopId: zObjectId.optional(),
  parentId: zObjectId.optional(),
});

// ─── Brand / Model ────────────────────────────────────────────────────────────

export const CreateBrandSchema = z.object({
  name: zNonEmptyString,
  shopId: zObjectId.optional(),
  description: z.string().trim().optional(),
});

export const CreateModelSchema = z.object({
  name: zNonEmptyString,
  brandId: zObjectId,
  shopId: zObjectId.optional(),
  description: z.string().trim().optional(),
});
