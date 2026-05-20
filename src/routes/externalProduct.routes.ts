import { Router } from "express";
import { searchExternalProducts, fetchExternalSourceDetails } from "../controllers/externalProduct.controller";
import { auth } from "../middlewares/auth";
import { requireRoles } from "../middlewares/rbac.middleware";
import { validate } from "../middlewares/validate";
import { ExternalProductGoogleSearchSchema, ExternalProductSourceDetailsSchema } from "../schemas";

const router = Router();

const SEARCH_ROLES = ["MASTER_ADMIN", "MANAGER"];

router.post("/search", auth, requireRoles(...SEARCH_ROLES), validate(ExternalProductGoogleSearchSchema), searchExternalProducts);
router.post("/source-details", auth, requireRoles(...SEARCH_ROLES), validate(ExternalProductSourceDetailsSchema), fetchExternalSourceDetails);
router.post("/google-search", auth, requireRoles(...SEARCH_ROLES), validate(ExternalProductGoogleSearchSchema), searchExternalProducts);

export default router;
