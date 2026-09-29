import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { env } from "../config/env";
import { hmacHex } from "../common/security";
import type { VisitDto } from "./visit.dto";

/**
 * Privacy-friendly visit counter. No cookies, and no raw IPs are stored: a
 * visit keeps only visitor = HMAC(secret, day + IP + user agent), which
 * changes daily and can't be reversed — enough to count unique visitors per
 * day, not enough to follow anyone around.
 */

const BOT_UA =
  /bot|crawl|spider|slurp|preview|fetch|scan|monitor|uptime|pingdom|lighthouse|headless|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|node|axios|go-http|java\/|okhttp|vercel/i;

const REFERRER_NAMES: [RegExp, string][] = [
  [/(^|\.)google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "X / Twitter"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$/, "Facebook"],
];

/** Today's date in Jakarta, e.g. "2026-09-29" — the day boundary for stats. */
function jakartaDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

/** A readable source name, null for direct visits, undefined for our own pages (reloads). */
function referrerLabel(referer: string | undefined, host: string | undefined): string | null | undefined {
  if (!referer) return null;
  try {
    const refHost = new URL(referer).hostname.replace(/^www\./, "").toLowerCase();
    const ownHost = host?.split(":")[0].replace(/^www\./, "").toLowerCase();
    if (ownHost && refHost === ownHost) return undefined;
    return REFERRER_NAMES.find(([re]) => re.test(refHost))?.[1] ?? refHost.slice(0, 80);
  } catch {
    return null;
  }
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Stores one visit; silently skips bots and reloads from the site itself. */
  async record(v: VisitDto) {
    const secret = env().adminSessionSecret;
    const db = this.supabase.client;
    if (!secret || !db || !v.ua || BOT_UA.test(v.ua)) return;

    const referrer = referrerLabel(v.referrer, v.host);
    if (referrer === undefined) return;

    const day = jakartaDay();
    const { error } = await db.from("page_views").insert({
      day,
      visitor: hmacHex(secret, `visit|${day}|${v.ip}|${v.ua}`).slice(0, 32),
      referrer,
      country: v.country ?? null,
      device: /Mobi|Android|iPhone|iPad/i.test(v.ua) ? "mobile" : "desktop",
      lang: v.lang,
    });
    if (error) this.logger.error(`Visit insert failed: ${error.message}`);
  }

  /** Aggregates from the admin_visit_stats() SQL function, or null if unavailable. */
  async stats() {
    const db = this.supabase.client;
    if (!db) return null;
    const { data, error } = await db
      .rpc("admin_visit_stats", { p_today: jakartaDay(), p_days: 30 })
      .abortSignal(AbortSignal.timeout(8_000));
    if (error) {
      this.logger.error(`Stats query failed: ${error.message}`);
      return null;
    }
    return data;
  }
}
