import { Router } from "express";
import { listPublicShops, getPublicShop } from "../controllers/publicStore.controller";

const router = Router();

router.get("/shops", listPublicShops);
router.get("/shops/:shopId", getPublicShop);

export default router;
