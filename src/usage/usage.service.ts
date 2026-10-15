import { Body, Controller, Global, HttpCode, Injectable, Logger, Module, Post, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { IsIn, IsString, MaxLength } from "class-validator";
import { SupabaseService } from "../supabase/supabase.service";
import { env } from "../config/env";
import { InternalKeyGuard } from "../common/internal-key.guard";
import { RollingLimit } from "../common/rolling-limit";
import { hmacHex } from "../common/security";
import { BOT_UA, jakartaDay, shiftDay } from "../common/visitors";

const USAGE_KINDS = ["cv_download", "chat_conversation", "chat_message", "chat_failed"] as const;
type UsageKind = (typeof USAGE_KINDS)[number];

/** Sent by the frontend server when it serves the CV. */
class CvDownloadDto {
  @IsIn(["cv_download"]) kind: "cv_download";
  @IsString() @MaxLength(64) ip: string;
  @IsString() @MaxLength(512) ua: string;
}

interface Totals {
  today: number;
  week: number;
  month: number;
  all: number;
}

/**
 * Daily counters for CV downloads and Tinn (conversations, messages, failed
 * replies). Only numbers per day are stored — nothing about who. Counting is
 * fire-and-forget, so it can never slow down or break the thing it counts.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  private readonly globalLimit = new RollingLimit(600, 60_000);
  // A CV download counts once per visitor per day (daily-rotating hash, in memory only).
  private cvToday = { day: "", seen: new Set<string>() };
  private warned = false;

  constructor(private readonly supabase: SupabaseService) {}

  bump(kind: UsageKind) {
    const db = this.supabase.client;
    if (!db || !this.globalLimit.take()) return;
    void db.rpc("bump_usage", { p_day: jakartaDay(), p_kind: kind }).then(({ error }) => {
      if (error && !this.warned) {
        this.warned = true; // once is enough; usually schema.sql hasn't been re-run yet
        this.logger.warn(`Usage counter unavailable: ${error.message}`);
      }
    });
  }

  recordCvDownload({ ip, ua }: CvDownloadDto) {
    const secret = env().adminSessionSecret;
    if (!secret || !ua || BOT_UA.test(ua)) return;
    const day = jakartaDay();
    if (this.cvToday.day !== day || this.cvToday.seen.size > 50_000) this.cvToday = { day, seen: new Set() };
    const visitor = hmacHex(secret, `cv|${day}|${ip}|${ua}`).slice(0, 32);
    if (this.cvToday.seen.has(visitor)) return;
    this.cvToday.seen.add(visitor);
    this.bump("cv_download");
  }

  /** Totals per kind for today, the last 7 and 30 days, and all time; null if unavailable. */
  async stats(): Promise<Record<UsageKind, Totals> | null> {
    const db = this.supabase.client;
    if (!db) return null;
    const { data, error } = await db.from("usage_daily").select("day, kind, count").limit(10_000)
      .abortSignal(AbortSignal.timeout(8_000));
    if (error) {
      this.logger.warn(`Usage query failed: ${error.message}`);
      return null;
    }
    const today = jakartaDay();
    const weekStart = shiftDay(today, -6);
    const monthStart = shiftDay(today, -29);
    const out = Object.fromEntries(USAGE_KINDS.map((k) => [k, { today: 0, week: 0, month: 0, all: 0 }])) as Record<UsageKind, Totals>;
    for (const row of data as { day: string; kind: UsageKind; count: number }[]) {
      const t = out[row.kind];
      if (!t) continue;
      t.all += row.count;
      if (row.day >= monthStart) t.month += row.count;
      if (row.day >= weekStart) t.week += row.count;
      if (row.day === today) t.today += row.count;
    }
    return out;
  }
}

@Controller("usage")
class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** Server-to-server from the frontend (it serves the CV); the key stops anyone inflating the count. */
  @Post()
  @HttpCode(204)
  @SkipThrottle() // every call comes from the frontend server's IP
  @UseGuards(InternalKeyGuard)
  record(@Body() dto: CvDownloadDto) {
    this.usage.recordCvDownload(dto);
  }
}

@Global()
@Module({ controllers: [UsageController], providers: [UsageService], exports: [UsageService] })
export class UsageModule {}
