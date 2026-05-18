import { Request, Response, NextFunction } from "express";
import { isValidObjectId } from "mongoose";

/**
 * Validates that one or more route params are valid MongoDB ObjectIds.
 * Prevents DB queries with malformed IDs and hides collection structure from error messages.
 *
 * Usage: router.get("/:id", validateObjectId("id"), handler)
 *        router.post("/transfer", validateObjectId("sourceId", "destinationId"), handler)
 */
export function validateObjectId(...paramNames: string[]) {
  const params = paramNames.length > 0 ? paramNames : ["id"];

  return (req: Request, res: Response, next: NextFunction) => {
    for (const param of params) {
      const value = req.params[param];

      if (!value || !isValidObjectId(value)) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ID",
          message: `Invalid ${param}`,
        });
      }
    }

    return next();
  };
}
