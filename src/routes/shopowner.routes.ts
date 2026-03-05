// src/routes/shopowner.routes.ts
import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireRoles } from "../middlewares/rbac.middleware";
import { upload } from "../middlewares/upload"; // ✅ your multer middleware
import {
  createShopOwner,
  listShopOwners,
  getShopOwner,
  updateShopOwner,
  deleteShopOwner,
  toggleShopOwnerActive,
  shopOwnerLogin,
  shopOwnerRefresh,
  shopOwnerLogout,
  getShopOwnerMe,
  shopOwnerAvatarUpload,
  shopOwnerAvatarRemove,
  masterShopOwnerAvatarUpload,
  masterShopOwnerAvatarRemove,
    masterShopOwnerDocsUpload,
  masterShopOwnerDocsRemove,
} from "../controllers/shopowner.controller";

const router = Router();

const uploadFields = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "idproof", maxCount: 1 }, // if you use it later
]);
  
/* ===================== AUTH (PUBLIC) ===================== */
router.post("/login", shopOwnerLogin);
router.post("/refresh", shopOwnerRefresh);

/* ===================== SHOP_OWNER (SELF) ===================== */
router.post("/logout", auth, requireRoles("SHOP_OWNER"), shopOwnerLogout);
router.get("/me", auth, requireRoles("SHOP_OWNER"), getShopOwnerMe);

router.post(
  "/me/avatar",
  auth,
  requireRoles("SHOP_OWNER"),
  upload.single("avatar"),
  shopOwnerAvatarUpload
);

router.delete(
  "/me/avatar",
  auth,
  requireRoles("SHOP_OWNER"),
  shopOwnerAvatarRemove
);

/* ===================== ADMIN CREATE ===================== */
/** ✅ IMPORTANT: createdBy schema supports only MASTER_ADMIN | MANAGER */
router.post("/", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), uploadFields, createShopOwner);

/* ===================== ADMIN ACTIVE TOGGLE ===================== */
router.put("/:id/activate", auth, requireRoles("MASTER_ADMIN", "MANAGER"), toggleShopOwnerActive);

/* ===================== ADMIN CRUD ===================== */
router.get("/", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), listShopOwners);
router.get("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), getShopOwner);
router.put("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), updateShopOwner);
router.delete("/:id", auth, requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"), deleteShopOwner);

  /* ===================== ADMIN AVATAR (BY ID) ===================== */
router.put(
  "/:id/avatar",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER","SUPERVISOR", "STAFF"),
  upload.single("avatar"),
  masterShopOwnerAvatarUpload
);

router.delete(
  "/:id/avatar",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER","SUPERVISOR", "STAFF"),
  masterShopOwnerAvatarRemove
);
/* ===================== ADMIN DOCS (BY ID) ===================== */
router.put(
  "/:id/docs",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  upload.fields([
    { name: "idProof", maxCount: 1 },
    { name: "gstCertificate", maxCount: 1 },
    { name: "udyamCertificate", maxCount: 1 },
  ]),
  masterShopOwnerDocsUpload
);

router.delete(
  "/:id/docs/:key",
  auth,
  requireRoles("MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"),
  masterShopOwnerDocsRemove
);
export default router;