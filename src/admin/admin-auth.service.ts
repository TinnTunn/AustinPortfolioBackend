import { Injectable, Logger } from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { SupabaseService } from "../supabase/supabase.service";
import { env } from "../config/env";
import { hmacHex } from "../common/security";

const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_IP = 5;
const MAX_FAILURES_TOTAL = 30; // across all IPs — caps distributed guessing

export type LoginResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; reason: "unconfigured" | "unavailable" | "locked" | "invalid" };

/**
 * Password check via Supabase Auth, behind a brute-force limiter whose
 * counters live in the database, so restarts don't reset them. Only the
 * address in ADMIN_EMAIL can ever get in, even if someone else manages to
 * create a Supabase user.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(private readonly supabase: SupabaseService) {}

  configured() {
    const e = env();
    return Boolean(this.supabase.client && e.adminEmail && e.adminSessionSecret);
  }

  async login(email: string, password: string, ip: string): Promise<LoginResult> {
    if (!this.configured()) return { ok: false, reason: "unconfigured" };
    const ipHash = hmacHex(env().adminSessionSecret!, `login|${ip}`).slice(0, 32);

    const gate = await this.gate(ipHash);
    if (gate !== "open") return { ok: false, reason: gate };
    const user = await this.verifyPassword(email, password);
    await this.record(ipHash, Boolean(user));
    return user ? { ok: true, user } : { ok: false, reason: "invalid" };
  }

  /** Fails closed: if the attempt counter can't be read, nobody logs in. */
  private async gate(ipHash: string): Promise<"open" | "locked" | "unavailable"> {
    const db = this.supabase.client!;
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const [mine, total] = await Promise.all([
      db.from("admin_login_attempts").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).eq("success", false).gte("created_at", since),
      db.from("admin_login_attempts").select("id", { count: "exact", head: true })
        .eq("success", false).gte("created_at", since),
    ]);
    // A count-only (HEAD) query on a missing table comes back with no error but
    // a null count — treat that as "can't tell", never as zero failures.
    if (mine.error || total.error || mine.count === null || total.count === null) {
      this.logger.error(`Login limiter unavailable: ${(mine.error ?? total.error)?.message ?? "no count returned"}`);
      return "unavailable";
    }
    return mine.count < MAX_FAILURES_PER_IP && total.count < MAX_FAILURES_TOTAL ? "open" : "locked";
  }

  private async record(ipHash: string, success: boolean) {
    const db = this.supabase.client!;
    const { error } = await db.from("admin_login_attempts").insert({ ip_hash: ipHash, success });
    if (error) this.logger.error(`Couldn't record a login attempt: ${error.message}`);
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    await db.from("admin_login_attempts").delete().lt("created_at", cutoff);
  }

  private async verifyPassword(email: string, password: string) {
    const { adminEmail, supabaseUrl, supabaseServiceKey } = env();
    if (email.toLowerCase() !== adminEmail) return null;

    // Throwaway client: the Supabase session it gets is revoked right away —
    // the admin panel runs on its own short-lived signed cookie instead.
    const client = createClient(supabaseUrl!, supabaseServiceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user?.email || data.user.email.toLowerCase() !== adminEmail) return null;

    await client.auth.admin.signOut(data.session.access_token).catch(() => undefined);
    return { id: data.user.id, email: data.user.email };
  }
}
