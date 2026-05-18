import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

type ValidateTarget = "body" | "query" | "params";

/**
 * Zod validation middleware factory.
 * Parses and strips unknown fields (strip mode), then replaces req[target] with the safe result.
 *
 * Usage:
 *   router.post("/", validate(MySchema), handler)
 *   router.get("/", validate(QuerySchema, "query"), handler)
 */
export function validate(schema: ZodSchema, target: ValidateTarget = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        errors,
      });
    }

    // Replace with parsed+sanitised data (strips unknown fields)
    (req as any)[target] = result.data;

    return next();
  };
}

// ─── Reusable field validators ────────────────────────────────────────────────

export const zObjectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Invalid ID");

export const zMobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Invalid mobile number (must be 10 digits starting 6-9)");

export const zPincode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Invalid pincode (must be 6 digits)");

export const zGst = z
  .string()
  .trim()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
    "Invalid GST number"
  )
  .optional()
  .or(z.literal(""));

export const zNonEmptyString = z.string().trim().min(1, "This field is required");

export const zPositiveNumber = z
  .number({ error: "Must be a number" })
  .positive("Must be greater than zero");

export const zNonNegativeNumber = z
  .number({ error: "Must be a number" })
  .min(0, "Must be zero or greater");
