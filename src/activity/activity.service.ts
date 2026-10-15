import { Controller, Get, Global, Injectable, Logger, Module, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SupabaseService } from "../supabase/supabase.service";
import { OriginGuard } from "../common/origin.guard";
import { RollingLimit } from "../common/rolling-limit";
import { clientIp } from "../common/security";
import { AdminGuard } from "../admin/admin.guard";

export const KEEP_ACTIVITY_DAYS = 180;

/**
 * The admin activity log: sign-ins (including failed attempts), password
 * changes, and every change made in /admin, with the IP and browser it came
 * from. Writing never blocks or fails the request it describes.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  // Failed sign-ins come from strangers; cap how fast they can grow the table.
  private readonly limit = new RollingLimit(300, 60 * 60_000);

  constructor(private readonly supabase: SupabaseService) {}

  /** `summary` is shown as plain text in /admin; keep it short and human. */
  log(action: string, summary: string, req?: Request) {
    const db = this.supabase.client;
    if (!db || !this.limit.take()) return;
    const ua = req?.headers["user-agent"];
    void db
      .from("admin_activity")
      .insert({
        action: action.slice(0, 40),
        summary: summary.slice(0, 300),
        ip: req ? clientIp(req).slice(0, 64) : null,
        user_agent: typeof ua === "string" ? ua.slice(0, 300) : null,
      })
      .then(({ error }) => {
        if (error) this.logger.warn(`Activity not recorded (${action}): ${error.message}`);
      });
  }

  /** The latest entries, newest first; null when the table isn't set up yet. */
  async recent(limit = 100) {
    const db = this.supabase.client;
    if (!db) return null;
    const { data, error } = await db
      .from("admin_activity")
      .select("id, created_at, action, summary, ip, user_agent")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      this.logger.warn(`Activity query failed: ${error.message}`);
      return null;
    }
    return data;
  }
}

@Controller("admin/activity")
@UseGuards(OriginGuard, AdminGuard)
class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** `{ items: null }` means the table is missing (schema.sql not re-run yet). */
  @Get()
  async list() {
    return { items: await this.activity.recent() };
  }
}

@Global()
@Module({ controllers: [ActivityController], providers: [ActivityService], exports: [ActivityService] })
export class ActivityModule {}
