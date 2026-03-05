import type { Request } from "express";
import type { Role } from "../utils/jwt";

export type AuthUser = { id: string; role: Role };
export type AuthRequest = Request & { user?: AuthUser };