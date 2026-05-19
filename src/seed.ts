/**
 * GloboGreen Demo Data Seed Script
 * Run: npx ts-node src/seed.ts
 *
 * Uses existing catalog data (categories, subcategories, brands, models,
 * product types). Does NOT duplicate existing records — checks before inserting.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./config/db";
import { CategoryModel } from "./models/category.model";
import { SubCategoryModel } from "./models/subcategory.model";
import { BrandModel } from "./models/brand.model";
import { ModelModel } from "./models/model.model";
import { ProductTypeModel } from "./models/productType.model";
import { ProductModel } from "./models/product.model";
import { ShopModel } from "./models/shop.model";
import { ShopOwnerModel } from "./models/shopowner.model";
import { ShopProductModel } from "./models/shopProduct.model";
import { VendorModel } from "./models/vendor.model";
import { CustomerModel } from "./models/customer.model";
import { PurchaseOrderModel } from "./models/purchase.model";
import { OrderModel } from "./models/order.model";
import { InvoiceModel } from "./models/invoice.model";
import MasterModel from "./models/master.model";
import { StockTransferModel } from "./models/stockTransfer.model";

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sku(prefix: string, idx: number) {
  return `${prefix}-${String(idx).padStart(4, "0")}`;
}

function phone() {
  const prefixes = ["9876", "9845", "9743", "8765", "7654", "9988"];
  return pick(prefixes) + String(randInt(100000, 999999));
}

function email(name: string, idx: number) {
  return `${name.toLowerCase().replace(/\s+/g, ".")}${idx}@demo.gg`;
}

/* ─────────────────────────────────────────────────────────────
   Green-product definitions (name, description, price range)
───────────────────────────────────────────────────────────── */

const PRODUCT_DEFS = [
  { name: "Solar LED Lantern 10W",     desc: "Portable solar powered LED lantern for outdoor use",  purchase: 850,  mrp: 1499 },
  { name: "Bamboo Water Bottle 750ml", desc: "Eco-friendly natural bamboo insulated water bottle",    purchase: 299,  mrp: 599  },
  { name: "Organic Neem Fertilizer 5kg", desc: "100% organic neem cake fertilizer for home gardens", purchase: 180,  mrp: 349  },
  { name: "Solar Panel 20W Mono",      desc: "Monocrystalline 20W solar panel for small appliances", purchase: 1800, mrp: 2999 },
  { name: "Compost Bin 30L",           desc: "Home composting bin with aeration holes",               purchase: 450,  mrp: 799  },
  { name: "LED Bulb 9W Warm White",    desc: "Energy-saving 9W LED bulb, 3000K warm white",          purchase: 55,   mrp: 120  },
  { name: "Eco Jute Shopping Bag",     desc: "Reusable jute shopping bag with cotton handles",        purchase: 45,   mrp: 99   },
  { name: "Rainwater Harvesting Kit",  desc: "Basic rainwater collection and filter kit 500L",        purchase: 2200, mrp: 3499 },
  { name: "Solar Garden Light 6-pack", desc: "Waterproof solar-powered pathway garden lights",        purchase: 680,  mrp: 1299 },
  { name: "Biodegradable Cutlery Set", desc: "100-piece bamboo fiber cutlery set, fully compostable", purchase: 160,  mrp: 299  },
  { name: "Wind-Up Torch 3LED",        desc: "Emergency wind-up dynamo torch, no batteries needed",   purchase: 220,  mrp: 449  },
  { name: "Vermicompost 5kg Bag",      desc: "Ready-to-use vermicompost for organic farming",         purchase: 120,  mrp: 249  },
];

/* ─────────────────────────────────────────────────────────────
   Indian demo customer names
───────────────────────────────────────────────────────────── */

const CUSTOMER_NAMES = [
  "Arjun Kumar",   "Priya Sharma",   "Ravi Patel",      "Anita Reddy",
  "Suresh Nair",   "Kavitha Menon",  "Deepak Joshi",    "Meena Iyer",
  "Vikram Singh",  "Sunita Verma",   "Rajesh Pillai",   "Nandini Rao",
  "Karthik Babu",  "Lakshmi Devi",   "Manoj Tiwari",    "Divya Krishnan",
  "Ajay Bhat",     "Rekha Nambiar",  "Sanjay Gupta",    "Pooja Kulkarni",
];

/* ─────────────────────────────────────────────────────────────
   Vendor names
───────────────────────────────────────────────────────────── */

const VENDOR_NAMES = [
  { name: "GreenSource Distributors", code: "GSD001" },
  { name: "EcoSupply India",           code: "ECO001" },
  { name: "SolarTech Wholesale",       code: "STW001" },
  { name: "NaturaCraft Supplies",      code: "NCS001" },
  { name: "BioFarm Traders",           code: "BFT001" },
];

/* ─────────────────────────────────────────────────────────────
   Main seed function
───────────────────────────────────────────────────────────── */

async function seed() {
  await connectDB();
  console.log("\n🌱 GloboGreen Seed Script Starting…\n");

  /* ── 1. Load catalog data ── */
  const [categories, subcategories, brands, models, productTypes, masterAdmin] =
    await Promise.all([
      CategoryModel.find({ isActive: true }).lean(),
      SubCategoryModel.find({ isActive: true }).lean(),
      BrandModel.find({ isActive: true }).lean(),
      ModelModel.find({ isActive: true }).lean(),
      ProductTypeModel.find({ isActive: true }).lean(),
      MasterModel.findOne({ role: "MASTER_ADMIN" }).lean(),
    ]);

  if (!masterAdmin) {
    console.error("❌  No MASTER_ADMIN found. Create a master admin first.");
    process.exit(1);
  }

  if (categories.length === 0) {
    console.error("❌  No categories found. Seed catalog data first.");
    process.exit(1);
  }

  const adminId  = masterAdmin._id as mongoose.Types.ObjectId;
  const adminRole = "MASTER_ADMIN";

  console.log(`✅  Catalog: ${categories.length} categories, ${brands.length} brands, ${models.length} models, ${productTypes.length} product types`);

  /* ── 2. Load shops ── */
  const shops = await ShopModel.find({ isActive: true }).lean();
  if (shops.length === 0) {
    console.warn("⚠️   No active shops found — shop-level data will be skipped.");
  }

  /* ── 3. Create master products ── */
  console.log("\n📦  Creating master products…");
  const productIds: mongoose.Types.ObjectId[] = [];

  for (let i = 0; i < PRODUCT_DEFS.length; i++) {
    const def = PRODUCT_DEFS[i];
    const skuVal = sku("GG", i + 1);

    const existing = await ProductModel.findOne({ sku: skuVal }).lean();
    if (existing) {
      console.log(`   ⏭️  Skipping "${def.name}" — already exists`);
      productIds.push(existing._id as mongoose.Types.ObjectId);
      continue;
    }

    const catIdx  = i % Math.max(categories.length, 1);
    const subcatIdx = i % Math.max(subcategories.length, 1);
    const brandIdx = i % Math.max(brands.length, 1);
    const ptIdx    = i % Math.max(productTypes.length, 1);
    const modelIdx = i % Math.max(models.length, 1);

    const doc = await ProductModel.create({
      itemName:          def.name,
      sku:               skuVal,
      description:       def.desc,
      configurationMode: "variant",
      categoryId:        categories[catIdx]._id,
      subcategoryId:     subcategories[subcatIdx]?._id ?? categories[0]._id,
      productTypeId:     productTypes[ptIdx]._id,
      brandId:           brands[brandIdx]._id,
      modelId:           models[modelIdx]?._id ?? null,
      approvalStatus:    "APPROVED",
      isActiveGlobal:    true,
      isActive:          true,
      createdBy:         adminId,
      createdByRole:     adminRole,
      variant: [
        {
          title:       "Default",
          description: "",
          attributes:  [],
          images:      [],
          videos:      [],
          compatible:  [],
          productInformation: [],
          isActive:    true,
        },
      ],
    });

    console.log(`   ✅  Created product: ${def.name} (${skuVal})`);
    productIds.push(doc._id as mongoose.Types.ObjectId);
  }

  /* ── 4. Per-shop seeding ── */
  for (const shop of shops) {
    const shopId         = shop._id as mongoose.Types.ObjectId;
    const shopOwnerId    = shop.shopOwnerAccountId as mongoose.Types.ObjectId;
    const shopName       = shop.name;

    console.log(`\n🏪  Seeding shop: ${shopName} (${shopId})`);

    /* ── 4a. Vendors ── */
    const vendorIds: mongoose.Types.ObjectId[] = [];
    for (const vdef of VENDOR_NAMES) {
      const existing = await VendorModel.findOne({ shopId, code: vdef.code }).lean();
      if (existing) {
        vendorIds.push(existing._id as mongoose.Types.ObjectId);
        continue;
      }
      const vendor = await VendorModel.create({
        shopId,
        code:      vdef.code,
        vendorName: vdef.name,
        vendorKey: vdef.name.toLowerCase().replace(/\s+/g, "-"),
        mobile:    phone(),
        email:     `${vdef.code.toLowerCase()}@vendor.gg`,
        status:    "ACTIVE",
        createdBy: {
          type: "SHOP_OWNER",
          id:   shopOwnerId,
          role: "SHOP_OWNER",
        },
      });
      vendorIds.push(vendor._id as mongoose.Types.ObjectId);
      console.log(`   ✅  Vendor: ${vdef.name}`);
    }

    /* ── 4b. Shop products ── */
    const shopProductMap = new Map<string, mongoose.Types.ObjectId>(); // productId → shopProductId

    for (let i = 0; i < productIds.length; i++) {
      const productId = productIds[i];
      const def       = PRODUCT_DEFS[i];
      const skuVal    = sku("GG", i + 1);
      const itemCode  = `SP-${String(i + 1).padStart(3, "0")}`;

      const existing = await ShopProductModel.findOne({ shopId, productId }).lean();
      if (existing) {
        shopProductMap.set(String(productId), existing._id as mongoose.Types.ObjectId);
        continue;
      }

      const sellingPrice = round2(def.mrp * 0.85);
      const marginAmount = round2(sellingPrice - def.purchase);

      const sp = await ShopProductModel.create({
        shopId,
        productId,
        sku:            skuVal,
        itemCode,
        itemName:       def.name,
        mainUnit:       "Pcs",
        qty:            randInt(20, 200),
        lowStockQty:    5,
        singlePricing: {
          pricingType:          "SINGLE",
          inputPrice:           def.purchase,
          mrpPrice:             def.mrp,
          baseRangeDownPercent: 10,
          rangeDownPercent:     5,
          marginAmount,
          marginPrice:          sellingPrice,
          unitSellingPrice:     sellingPrice,
          totalPurchasePrice:   def.purchase,
          negotiationAmount:    0,
          minSellingPrice:      round2(def.purchase * 1.02),
          maxSellingPrice:      def.mrp,
          sellingPrice,
        },
        isActive:       true,
        createdBy:      shopOwnerId,
        createdByRole:  "SHOP_OWNER",
      });

      shopProductMap.set(String(productId), sp._id as mongoose.Types.ObjectId);
      console.log(`   ✅  ShopProduct: ${def.name}`);
    }

    /* ── 4c. Purchase orders ── */
    const purchaseCount = await PurchaseOrderModel.countDocuments({ shopId });
    if (purchaseCount === 0) {
      console.log("   📋  Creating purchase orders…");

      const vendor = vendorIds[0];
      const purchaseDates = [
        new Date(Date.now() - 60 * 24 * 3600_000),
        new Date(Date.now() - 30 * 24 * 3600_000),
        new Date(Date.now() - 10 * 24 * 3600_000),
      ];

      for (let pIdx = 0; pIdx < purchaseDates.length; pIdx++) {
        const dateVal = purchaseDates[pIdx];
        const purchaseNo = `PO-${String(shopId).slice(-4).toUpperCase()}-${String(pIdx + 1).padStart(3, "0")}`;

        // Pick 3–4 products per purchase
        const itemCount = randInt(3, 5);
        const items: any[] = [];
        let subtotal = 0;

        for (let j = 0; j < itemCount; j++) {
          const pidx    = (pIdx * itemCount + j) % productIds.length;
          const productId = productIds[pidx];
          const def     = PRODUCT_DEFS[pidx];
          const qty     = randInt(5, 30);
          const price   = def.purchase;
          const amount  = round2(price * qty);
          subtotal     += amount;

          items.push({
            supplierId:    vendor,
            shopProductId: shopProductMap.get(String(productId)) ?? null,
            productId,
            itemCode:      `SP-${String(pidx + 1).padStart(3, "0")}`,
            productName:   def.name,
            batch:         "",
            qty,
            purchasePrice: price,
            discount:      { percent: 0, amount: 0 },
            tax:           { label: "GST 18%", percent: 18 },
            purchaseAfterTax: round2(price * 1.18),
            amount,
          });
        }

        const taxAmount = round2(subtotal * 0.18);
        const netAmount = round2(subtotal + taxAmount);

        await PurchaseOrderModel.create({
          shopId,
          purchaseNo,
          mode:         "SINGLE_SUPPLIER",
          supplierId:   vendor,
          purchaseDate: dateVal,
          invoiceNo:    `VINV-${pIdx + 1}`,
          invoiceDate:  dateVal,
          payMode:      pick(["CASH", "UPI", "BANK_TRANSFER"]),
          status:       "SAVED",
          items,
          itemCount:    items.length,
          totalQty:     items.reduce((s: number, it: any) => s + it.qty, 0),
          subtotal:     round2(subtotal),
          taxAmount,
          discountAmount: 0,
          overallDiscount: 0,
          netAmount,
          notes:        "Demo purchase order",
          createdBy: {
            type: "SHOP_OWNER",
            id:   shopOwnerId,
            role: "SHOP_OWNER",
          },
        });

        console.log(`   ✅  Purchase: ${purchaseNo}`);
      }
    } else {
      console.log(`   ⏭️  Purchase orders already exist (${purchaseCount})`);
    }

    /* ── 4d. Customers ── */
    const customerIds: mongoose.Types.ObjectId[] = [];
    for (let ci = 0; ci < CUSTOMER_NAMES.length; ci++) {
      const cname  = CUSTOMER_NAMES[ci];
      const cmobile = phone();
      const cemail  = email(cname, ci + 1);

      const existing = await CustomerModel.findOne({ email: cemail }).lean();
      if (existing) {
        customerIds.push(existing._id as mongoose.Types.ObjectId);
        continue;
      }

      const c = await CustomerModel.create({
        name:           cname,
        email:          cemail,
        mobile:         cmobile,
        state:          pick(["Tamil Nadu", "Kerala", "Karnataka", "Maharashtra", "Delhi"]),
        address:        `${randInt(1, 200)}, Demo Street, City`,
        openingBalance: 0,
        dueBalance:     0,
        points:         0,
        isWalkIn:       false,
        isActive:       true,
      });
      customerIds.push(c._id as mongoose.Types.ObjectId);
    }
    console.log(`   ✅  Customers: ${customerIds.length}`);

    /* ── 4e. Direct sales (invoices) ── */
    const invoiceCount = await InvoiceModel.countDocuments({ shopId });
    if (invoiceCount === 0) {
      console.log("   🧾  Creating sale invoices…");

      const saleDates = Array.from({ length: 15 }, (_, k) =>
        new Date(Date.now() - (k + 1) * 2 * 24 * 3600_000)
      );

      const shopDoc = await ShopModel.findById(shopId).lean();
      const fromParty = {
        name:    shopDoc?.name ?? shopName,
        mobile:  shopDoc?.mobile ?? "",
        email:   "",
        state:   (shopDoc as any)?.shopAddress?.state ?? "",
        district:"",
        taluk:   "",
        area:    "",
        street:  "",
        pincode: "",
        gstin:   shopDoc?.gstNumber ?? "",
      };

      for (let si = 0; si < saleDates.length; si++) {
        const saleDate   = saleDates[si];
        const customerId = customerIds[si % customerIds.length];
        const cname      = CUSTOMER_NAMES[si % CUSTOMER_NAMES.length];

        const toParty = {
          name:    cname,
          mobile:  phone(),
          email:   "",
          state:   pick(["Tamil Nadu", "Kerala", "Karnataka"]),
          district: "",
          taluk:   "",
          area:    "",
          street:  "",
          pincode: "",
          gstin:   "",
        };

        // Build 1–3 items per sale
        const numItems = randInt(1, 3);
        const items: any[] = [];
        let subtotal = 0;

        for (let j = 0; j < numItems; j++) {
          const pidx      = (si + j) % productIds.length;
          const productId = productIds[pidx];
          const def       = PRODUCT_DEFS[pidx];
          const qty       = randInt(1, 3);
          const price     = round2(def.mrp * 0.85);
          const taxPct    = 18;
          const taxAmt    = round2(price * qty * taxPct / 100);
          const lineTotal = round2(price * qty + taxAmt);
          subtotal       += lineTotal;

          items.push({
            productId,
            shopProductId: shopProductMap.get(String(productId)) ?? null,
            name:          def.name,
            sku:           sku("GG", pidx + 1),
            itemCode:      `SP-${String(pidx + 1).padStart(3, "0")}`,
            batch:         "",
            unit:          "Pcs",
            mrp:           def.mrp,
            qty,
            price,
            discountPercent: 0,
            discountAmount:  0,
            taxPercent:    taxPct,
            taxAmount:     taxAmt,
            lineTotal,
          });
        }

        const grandTotal = round2(subtotal);
        const payMethod  = pick(["CASH", "UPI", "CARD"]);

        // Create the Order record first
        const order = await OrderModel.create({
          customerId,
          shopId,
          source:    "DIRECT",
          items,
          itemCount: items.length,
          totalQty:  items.reduce((s: number, it: any) => s + it.qty, 0),
          subtotal,
          taxAmount: items.reduce((s: number, it: any) => s + it.taxAmount, 0),
          shippingFee: 0,
          discount:  0,
          grandTotal,
          customerNameSnapshot:   cname,
          customerMobileSnapshot: toParty.mobile,
          address: {
            label:    "Home",
            name:     cname,
            mobile:   toParty.mobile,
            state:    toParty.state,
            district: "",
            taluk:    "",
            area:     "",
            street:   `${randInt(1, 200)}, Main Road`,
            pincode:  String(randInt(600001, 699999)),
          },
          payment: {
            method:         payMethod,
            paid:           true,
            receivedAmount: grandTotal,
            changeAmount:   0,
          },
          status: "DELIVERED",
          deliveredAt: saleDate,
        });

        // Create Invoice linked to Order
        const invoice = await InvoiceModel.create({
          type:       "DIRECT",
          orderId:    order._id,
          customerId,
          shopId,
          from:       fromParty,
          to:         toParty,
          items,
          subtotal,
          tax:        items.reduce((s: number, it: any) => s + it.taxAmount, 0),
          shippingFee: 0,
          discount:   0,
          grandTotal,
          payment: {
            method:         payMethod,
            paid:           true,
            receivedAmount: grandTotal,
            changeAmount:   0,
          },
          issuedAt: saleDate,
        });

        // Link invoice back to order
        await OrderModel.findByIdAndUpdate(order._id, {
          invoiceId: invoice._id,
          invoiceNo: invoice.invoiceNo,
        });

        if (si < 3) {
          console.log(`   ✅  Invoice: ${invoice.invoiceNo}`);
        }
      }
      console.log(`   ✅  Created 15 sale invoices for ${shopName}`);
    } else {
      console.log(`   ⏭️  Invoices already exist (${invoiceCount})`);
    }

    /* ── 4f. Stock transfers (only if 2+ shops exist under same owner) ── */
    const siblingShops = await ShopModel.find({
      shopOwnerAccountId: shopOwnerId,
      isActive: true,
      _id: { $ne: shopId },
    }).lean();

    if (siblingShops.length > 0) {
      const transferCount = await StockTransferModel.countDocuments({ fromShopId: shopId });
      if (transferCount === 0) {
        const toShop = siblingShops[0];
        const toShopId = toShop._id as mongoose.Types.ObjectId;

        const transferItems = productIds.slice(0, 3).map((productId, idx) => ({
          productId,
          shopProductId: shopProductMap.get(String(productId)) ?? null,
          itemName:      PRODUCT_DEFS[idx].name,
          itemCode:      `SP-${String(idx + 1).padStart(3, "0")}`,
          qty:           randInt(5, 15),
          unit:          "Pcs",
        }));

        await StockTransferModel.create({
          shopOwnerAccountId: shopOwnerId,
          fromShopId:   shopId,
          toShopId,
          fromShopName: shopName,
          toShopName:   toShop.name,
          referenceNo:  `TRF-${String(shopId).slice(-4).toUpperCase()}-001`,
          transferDate: new Date(Date.now() - 5 * 24 * 3600_000),
          notes:        "Demo stock transfer",
          items:        transferItems,
          transferType: "FORWARD",
          status:       "COMPLETED",
          createdBy:    shopOwnerId,
          createdByRole: "SHOP_OWNER",
        });
        console.log(`   ✅  Stock transfer: ${shopName} → ${toShop.name}`);
      }
    }
  }

  console.log("\n✅  Seed complete!\n");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("❌  Seed failed:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
