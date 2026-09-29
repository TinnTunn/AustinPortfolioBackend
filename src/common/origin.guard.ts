import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../config/env";

/**
 * CSRF defence for browser-facing endpoints: requests that change state must
 * come from one of our own frontend origins. Browsers always send `Origin` on
 * cross-origin and on POST/PUT/PATCH/DELETE requests, and a page can't forge it.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
    const origin = req.headers.origin?.replace(/\/+$/, "");
    if (origin && env().frontendOrigins.includes(origin)) return true;
    throw new ForbiddenException("Request origin not allowed.");
  }
}
