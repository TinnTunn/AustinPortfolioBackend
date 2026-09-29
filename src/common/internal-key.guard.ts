import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../config/env";
import { safeEqual } from "./security";

/** Server-to-server endpoints: only the frontend server knows INTERNAL_API_KEY. */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = env().internalApiKey;
    const given = req.headers["x-internal-key"];
    if (expected && typeof given === "string" && safeEqual(given, expected)) return true;
    throw new UnauthorizedException();
  }
}
