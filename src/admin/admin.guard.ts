import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../config/env";
import { AdminSessionsService } from "./admin-sessions.service";
import { SESSION_COOKIE, verifyToken, type SessionPayload } from "./session-token";

export type AdminRequest = Request & { admin?: SessionPayload };

/**
 * Every admin endpoint sits behind this: a valid, unexpired, signed cookie for
 * ADMIN_EMAIL, issued after the last password change (older tokens — e.g. on
 * another device — are signed out), for a user that still exists.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly sessions: AdminSessionsService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const { adminSessionSecret, adminEmail } = env();
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const session = adminSessionSecret ? verifyToken(cookies?.[SESSION_COOKIE], adminSessionSecret) : null;
    if (!session || !adminEmail || session.email !== adminEmail) throw new UnauthorizedException();

    const validAfter = await this.sessions.validAfter(session.sub);
    if (validAfter === null || session.iat < validAfter) throw new UnauthorizedException();

    req.admin = session;
    return true;
  }
}
