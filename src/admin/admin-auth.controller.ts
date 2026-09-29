import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { OriginGuard } from "../common/origin.guard";
import { clientIp } from "../common/security";
import { AdminAuthService } from "./admin-auth.service";
import { AdminGuard, type AdminRequest } from "./admin.guard";
import { LoginDto } from "./admin.dto";
import { createToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session-token";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cookieOptions() {
  return {
    httpOnly: true, // page JavaScript can't read it
    secure: env().isProduction,
    sameSite: "strict" as const, // never sent on cross-site requests
    path: "/admin", // only sent to admin endpoints
  };
}

@Controller("admin")
@UseGuards(OriginGuard)
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email.trim(), dto.password, clientIp(req));
    if (!result.ok) {
      if (result.reason === "unconfigured") throw new ServiceUnavailableException("The admin panel isn't configured yet.");
      if (result.reason === "unavailable") {
        throw new ServiceUnavailableException("Login is unavailable — the database isn't ready (run supabase/schema.sql).");
      }
      if (result.reason === "locked") {
        throw new HttpException("Too many attempts. Please wait 15 minutes and try again.", HttpStatus.TOO_MANY_REQUESTS);
      }
      await wait(400); // slows scripted guessing; same message for every wrong email/password
      throw new UnauthorizedException("Email or password is incorrect.");
    }
    res.cookie(SESSION_COOKIE, createToken(result.user, env().adminSessionSecret!), {
      ...cookieOptions(),
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
    return { email: result.user.email };
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, cookieOptions());
  }

  @Get("session")
  @UseGuards(AdminGuard)
  session(@Req() req: AdminRequest) {
    return { email: req.admin!.email, expiresAt: req.admin!.exp * 1000 };
  }
}
