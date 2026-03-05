import { Router } from "express";
import subAdminRoutes from "./subadmin.routes";
import masterRoutes from "./master.routes";
import staffRoutes from"./staff.routes";
import shopownersRoutes from"./shopowner.routes";
import shopRoutes from "./shop.routes";
import shopstaffRoutes from"./shopstaff.routes";
import catalogRoutes from "./catalog.routes";
import shopCatalogMapRoutes from "./shopCatalogMap.routes";
import vendorGlobalRoutes from "./vendorGlobal.routes";
import shopVendorMapRoutes from "./shopVendorMap.routes";
import productGlobalRoutes from "./productGlobal.routes";
import shopProductRoutes from "./shopProduct.routes";
import customerRoutes from "./customer.public.routes";
import customerShopRoutes from "./customer.shop.routes";
import orderRoutes from "./order.routes";
import locationRoutes from "./location.routes";

const router = Router();

router.use("/subadmins", subAdminRoutes);
router.use("/master", masterRoutes);
router.use("/staff", staffRoutes);
router.use("/shopowners",shopownersRoutes);
router.use("/shops",shopRoutes);
router.use("/shopstaff",shopstaffRoutes);
router.use("/catalogRoutes", catalogRoutes);
router.use("/shopCatalogMap", shopCatalogMapRoutes);
router.use("/vendors", vendorGlobalRoutes);
router.use("/shopVendorMap", shopVendorMapRoutes);
router.use("/products", productGlobalRoutes);
router.use("/shopProducts", shopProductRoutes);
router.use("/customer", customerRoutes);
router.use("/customer/shops", customerShopRoutes);
router.use("/orders", orderRoutes);
router.use("/locations", locationRoutes);

export default router;