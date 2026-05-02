import { Router } from "express";
import {
  createBarcodeLabelFormat,
  deleteBarcodeLabelFormat,
  getUseBarcodeLabelFormat,
  listBarcodeLabelFormats,
  setUseBarcodeLabelFormat,
  updateBarcodeLabelFormat,
} from "../controllers/barcodeLabelFormat.controller";
import { listBarcodeProducts } from "../controllers/barcodePrint.controller";
import { auth } from "../middlewares/auth";

const router = Router();

router.use(auth);

router.get("/label-formats", listBarcodeLabelFormats);
router.get("/label-formats/use", getUseBarcodeLabelFormat);
router.post("/label-formats", createBarcodeLabelFormat);
router.put("/label-formats/:id", updateBarcodeLabelFormat);
router.put("/label-formats/:id/use", setUseBarcodeLabelFormat);
router.delete("/label-formats/:id", deleteBarcodeLabelFormat);

router.get("/barcode-products", listBarcodeProducts);

export default router;