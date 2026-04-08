import type { Request, Response, NextFunction } from "express";

function strip(obj: any) {
  if (!obj || typeof obj !== "object") return;

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (key.startsWith("$") || key.includes(".")) {
      delete obj[key];
      continue;
    }

    if (val && typeof val === "object") strip(val);
  }
}

export function sanitizeMongo(req: Request, res: Response, next: NextFunction) {
  strip(req.body);
  strip(req.params);
  strip(req.query);
  next();
}