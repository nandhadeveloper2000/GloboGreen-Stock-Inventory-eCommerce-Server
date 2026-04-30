import { Router } from "express";

import authRoutes from "./auth.routes";
import masterRoutes from "./master.routes";
import staffRoutes from "./staff.routes";
import shopownersRoutes from "./shopowner.routes";
import shopRoutes from "./shop.routes";
import shopstaffRoutes from "./shopstaff.routes";
import masterCategoryRoutes from "./masterCategory.routes";
import categoryRoutes from "./category.routes";
import subCategoryRoutes from "./subcategory.routes";
import brandRoutes from "./brand.routes";
import modelRoutes from "./model.routes";
import ProductCompatibilityRoutes from "./productCompatibility.routes";
import proudctRoutes from "./product.routes";
import shopCategoryMapRoutes from "./shopCategoryMap.routes";
import shopSubCategoryMapRoutes from "./shopSubCategoryMap.routes";
import shopBrandMapRoutes from "./shopBrandMap.routes";
import shopModelMapRoutes from "./shopModelMap.routes";
import vendorGlobalRoutes from "./vendor.routes";
import productGlobalRoutes from "./product.routes";
import shopProductRoutes from "./shopProduct.routes";
import customerRoutes from "./customer.public.routes";
import customerShopRoutes from "./customer.shop.routes";
import orderRoutes from "./order.routes";
import invoiceRoutes from "./invoice.routes";
import locationRoutes from "./location.routes";
import purchaseRoutes from "./purchase.routes";
import purchaseReturnRoutes from "./purchaseReturn.routes";

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
router.use("/master-categories", masterCategoryRoutes);
router.use("/categories", categoryRoutes);
router.use("/sub-categories", subCategoryRoutes);
router.use("/brands", brandRoutes);
router.use("/models", modelRoutes);
router.use("/productcompatibility", ProductCompatibilityRoutes);
router.use("/product", proudctRoutes);
router.use("/shop-category-maps", shopCategoryMapRoutes);
router.use("/shop-sub-category-maps", shopSubCategoryMapRoutes);
router.use("/shop-brand-maps", shopBrandMapRoutes);
router.use("/shop-model-maps", shopModelMapRoutes);
router.use("/vendors", vendorGlobalRoutes);
router.use("/products", productGlobalRoutes);
router.use("/shop-products", shopProductRoutes);
router.use("/purchase", purchaseRoutes);
router.use("/purchase-returns", purchaseReturnRoutes);
/* ---------------- CUSTOMER ---------------- */
router.use("/customer", customerRoutes);
router.use("/customer/shops", customerShopRoutes);

/* ---------------- OTHER ---------------- */
router.use("/orders", orderRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/locations", locationRoutes);

export default router;
