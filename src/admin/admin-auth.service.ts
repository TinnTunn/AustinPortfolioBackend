import { Injectable, Logger } from "@nestjs/common";
import { createServiceClient, SupabaseService } from "../supabase/supabase.service";
import { env } from "../config/env";
import { hmacHex } from "../common/security";
import { AdminSessionsService } from "./admin-sessions.service";

// Per IP only. A cap across *all* IPs would let anyone lock the real admin out
// just by failing logins on purpose; distributed guessing is already
// impractical against a 12+ character password with Supabase's own rate limits.
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_IP = 5;
// Recovery emails go out at most this often, whoever asks — the admin address
// is public, so this stops anyone flooding the inbox or the email quota.
const RECOVERY_COOLDOWN_MS = 10 * 60_000;

// Recovery links are valid for an hour by default; refuse anything older.
const RECOVERY_MAX_AGE_SECONDS = 60 * 60;

type LoginResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; reason: "unconfigured" | "unavailable" | "locked" | "invalid" };

type PasswordResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "unavailable" | "locked" | "invalid" | "same" }
  | { ok: false; reason: "rejected"; message: string };

/** Claims of a Supabase access token (already verified by Supabase before we read them). */
function claims(accessToken: string): { iat?: number; amr?: { method?: string }[] } {
  try {
    return JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Password check via Supabase Auth, behind a brute-force limiter whose
 * counters live in the database, so restarts don't reset them. Only the
 * address in ADMIN_EMAIL can ever get in, even if someone else manages to
 * create a Supabase user.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private lastRecoveryAt = 0;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly sessions: AdminSessionsService
  ) {}

  configured() {
    const e = env();
    return Boolean(this.supabase.client && e.adminEmail && e.adminSessionSecret);
  }

  private ipHash(ip: string) {
    return hmacHex(env().adminSessionSecret!, `login|${ip}`).slice(0, 32);
  }

  async login(email: string, password: string, ip: string): Promise<LoginResult> {
    if (!this.configured()) return { ok: false, reason: "unconfigured" };
    const ipHash = this.ipHash(ip);

    const gate = await this.gate(ipHash);
    if (gate !== "open") return { ok: false, reason: gate };
    const user = await this.verifyPassword(email, password);
    await this.record(ipHash, Boolean(user));
    return user ? { ok: true, user } : { ok: false, reason: "invalid" };
  }

  /**
   * Changes the signed-in admin's password. The current password is checked
   * like a login (same limiter, so this can't be used to guess it), and on
   * success every other session is signed out.
   */
  async changePassword(admin: { sub: string; email: string }, current: string, next: string, ip: string): Promise<PasswordResult> {
    if (!this.configured()) return { ok: false, reason: "unconfigured" };
    const ipHash = this.ipHash(ip);
    const gate = await this.gate(ipHash);
    if (gate !== "open") return { ok: false, reason: gate };

    const user = await this.verifyPassword(admin.email, current);
    await this.record(ipHash, Boolean(user && user.id === admin.sub));
    if (!user || user.id !== admin.sub) return { ok: false, reason: "invalid" };
    if (next === current) return { ok: false, reason: "same" };

    return this.setPassword(admin.sub, next);
  }

  /**
   * Emails a Supabase recovery link — but only to ADMIN_EMAIL, and the caller
   * always gets the same answer, so it can't be used to discover the address.
   */
  async sendRecovery(email: string) {
    const { adminEmail, frontendUrl } = env();
    if (!this.configured() || !frontendUrl || email.trim().toLowerCase() !== adminEmail) return;
    if (Date.now() - this.lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
      this.logger.warn("Recovery email skipped: one was sent less than 10 minutes ago");
      return;
    }
    this.lastRecoveryAt = Date.now();
    const { error } = await this.supabase.client!.auth.resetPasswordForEmail(adminEmail, {
      redirectTo: `${frontendUrl}/admin/reset-password`,
    });
    if (error) this.logger.error(`Recovery email failed: ${error.message}`);
  }

  /**
   * Sets a new password from a recovery link. Supabase verifies the token;
   * we additionally require it to be the admin's, minted by a recovery/email
   * link (not a password login), and recent. The recovery session is revoked
   * afterwards and every admin session is signed out.
   */
  async resetWithRecovery(accessToken: string, next: string): Promise<PasswordResult> {
    if (!this.configured()) return { ok: false, reason: "unconfigured" };
    const db = this.supabase.client!;
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user?.email || data.user.email.toLowerCase() !== env().adminEmail) return { ok: false, reason: "invalid" };

    const { iat, amr } = claims(accessToken);
    const fromEmailLink = amr?.some((m) => m.method === "recovery" || m.method === "otp");
    const fresh = typeof iat === "number" && Date.now() / 1000 - iat < RECOVERY_MAX_AGE_SECONDS;
    if (!fromEmailLink || !fresh) return { ok: false, reason: "invalid" };

    const result = await this.setPassword(data.user.id, next);
    if (result.ok) await db.auth.admin.signOut(accessToken).catch(() => undefined);
    return result;
  }

  private async setPassword(userId: string, next: string): Promise<PasswordResult> {
    const { error } = await this.supabase.client!.auth.admin.updateUserById(userId, { password: next });
    if (error) {
      this.logger.warn(`Password update rejected: ${error.message}`);
      // Supabase's own password policy (e.g. too weak) — safe to show.
      return { ok: false, reason: "rejected", message: error.message };
    }
    await this.sessions.revokeBefore(userId, Math.floor(Date.now() / 1000));
    return { ok: true };
  }

  /** Fails closed: if the attempt counter can't be read, nobody logs in. */
  private async gate(ipHash: string): Promise<"open" | "locked" | "unavailable"> {
    const db = this.supabase.client!;
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const mine = await db.from("admin_login_attempts").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).eq("success", false).gte("created_at", since);
    // A count-only (HEAD) query on a missing table comes back with no error but
    // a null count — treat that as "can't tell", never as zero failures.
    if (mine.error || mine.count === null) {
      this.logger.error(`Login limiter unavailable: ${mine.error?.message ?? "no count returned"}`);
      return "unavailable";
    }
    return mine.count < MAX_FAILURES_PER_IP ? "open" : "locked";
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
    const client = createServiceClient(supabaseUrl!, supabaseServiceKey!);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user?.email || data.user.email.toLowerCase() !== adminEmail) return null;

    await client.auth.admin.signOut(data.session.access_token).catch(() => undefined);
    return { id: data.user.id, email: data.user.email };
  }
}
