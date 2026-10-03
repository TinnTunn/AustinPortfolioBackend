import { Controller, Get, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { SupabaseService } from "../supabase/supabase.service";

const PING_EVERY_MS = 12 * 60 * 60_000;
const KEEP_VISITS_DAYS = 400; // a little over a year of stats

/**
 * Free-tier Supabase projects pause after about a week without traffic, which
 * breaks the admin panel and the contact archive. The API is always on, so it
 * simply makes one tiny read twice a day — and while it's there, drops visit
 * records older than about 13 months so the free 500 MB never fills up.
 */
@Injectable()
class KeepAliveService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KeepAliveService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly supabase: SupabaseService) {}

  onApplicationBootstrap() {
    if (!this.supabase.client) return;
    void this.ping();
    this.timer = setInterval(() => void this.ping(), PING_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async ping() {
    const db = this.supabase.client!;
    const { error } = await db.from("contact_messages").select("id").limit(1);
    if (error) this.logger.warn(`Supabase keep-alive failed: ${error.message}`);

    const cutoff = new Date(Date.now() - KEEP_VISITS_DAYS * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const pruned = await db.from("page_views").delete().lt("day", cutoff);
    if (pruned.error) this.logger.warn(`Old visit cleanup failed: ${pruned.error.message}`);
  }
}

/** Liveness probe for Railway. Deliberately doesn't touch the database. */
@Controller("health")
class HealthController {
  @Get()
  @SkipThrottle()
  check() {
    return { ok: true };
  }
}

@Module({ controllers: [HealthController], providers: [KeepAliveService] })
export class HealthModule {}
