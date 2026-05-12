import { Router } from "express";

import authRoutes from "./auth.routes";
import masterRoutes from "./master.routes";
import staffRoutes from "./staff.routes";
import shopownersRoutes from "./shopowner.routes";
import shopRoutes from "./shop.routes";
import shopstaffRoutes from "./shopstaff.routes";
import categoryRoutes from "./category.routes";
import subCategoryRoutes from "./subcategory.routes";
import brandRoutes from "./brand.routes";
import seriesRoutes from "./series.routes";
import modelRoutes from "./model.routes";
import productTypeRoutes from "./productType.routes";
import ProductCompatibilityRoutes from "./productCompatibility.routes";
import proudctRoutes from "./product.routes";
import shopCategoryMapRoutes from "./shopCategoryMap.routes";
import shopSubCategoryMapRoutes from "./shopSubCategoryMap.routes";
import shopBrandMapRoutes from "./shopBrandMap.routes";
import shopModelMapRoutes from "./shopModelMap.routes";
import vendorGlobalRoutes from "./vendor.routes";
import shopVendorRoutes from "./shopVendor.routes";
import productGlobalRoutes from "./product.routes";
import shopProductRoutes from "./shopProduct.routes";
import stockTransferRoutes from "./stockTransfer.routes";
import physicalStockRoutes from "./physicalStock.routes";
import barcodeRoutes from "./barcode.routes";
import expenseRoutes from "./expense.routes";
import customerRoutes from "./customer.public.routes";
import customerShopRoutes from "./customer.shop.routes";
import orderRoutes from "./order.routes";
import invoiceRoutes from "./invoice.routes";
import locationRoutes from "./location.routes";
import purchaseRoutes from "./purchase.routes";
import purchaseReturnRoutes from "./purchaseReturn.routes";
import salesReturnRoutes from "./salesReturn.routes";
import partyAccountRoutes from "./partyAccount.routes";
import paymentRoutes from "./payment.routes";
import discountRoutes from "./discount.routes";
import priceListRoutes from "./priceList.routes";
import notificationRoutes from "./notification.routes";
import reportsRoutes from "./reports.routes";
import dashboardRoutes from "./dashboard.routes";

const router = Router();

/* ---------------- SHARED AUTH ---------------- */
router.use("/auth", authRoutes);

/* ---------------- CORE USERS ---------------- */
router.use("/master", masterRoutes);
router.use("/staff", staffRoutes);

/* ---------------- SHOP / BUSINESS ---------------- */
router.use("/shopowners", shopownersRoutes);
router.use("/shops", shopRoutes);
router.use("/shopstaff", shopstaffRoutes);

/* ---------------- CATALOG / PRODUCTS / VENDORS ---------------- */
router.use("/categories", categoryRoutes);
router.use("/sub-categories", subCategoryRoutes);
router.use("/brands", brandRoutes);
router.use("/series", seriesRoutes);
router.use("/models", modelRoutes);
router.use("/product-types", productTypeRoutes);
router.use("/productcompatibility", ProductCompatibilityRoutes);
router.use("/product", proudctRoutes);
router.use("/shop-category-maps", shopCategoryMapRoutes);
router.use("/shop-sub-category-maps", shopSubCategoryMapRoutes);
router.use("/shop-brand-maps", shopBrandMapRoutes);
router.use("/shop-model-maps", shopModelMapRoutes);
router.use("/vendors", vendorGlobalRoutes);
router.use("/shop-vendors", shopVendorRoutes);
router.use("/products", productGlobalRoutes);
router.use("/shop-products", shopProductRoutes);
router.use("/stock-transfers", stockTransferRoutes);
router.use("/physical-stock", physicalStockRoutes);
router.use("/barcode", barcodeRoutes);
router.use("/expenses", expenseRoutes);
router.use("/purchase", purchaseRoutes);
router.use("/purchase-returns", purchaseReturnRoutes);
router.use("/sales-returns", salesReturnRoutes);
router.use("/party-accounts", partyAccountRoutes);

/* ---------------- CUSTOMER ---------------- */
router.use("/customer", customerRoutes);
router.use("/customer/shops", customerShopRoutes);

/* ---------------- PAYMENTS / DISCOUNTS / PRICE LISTS ---------------- */
router.use("/payments", paymentRoutes);
router.use("/discounts", discountRoutes);
router.use("/price-lists", priceListRoutes);

/* ---------------- NOTIFICATIONS ---------------- */
router.use("/notifications", notificationRoutes);

/* ---------------- REPORTS ---------------- */
router.use("/reports", reportsRoutes);

/* ---------------- DASHBOARD ---------------- */
router.use("/dashboard", dashboardRoutes);

/* ---------------- OTHER ---------------- */
router.use("/orders", orderRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/locations", locationRoutes);

export default router;
