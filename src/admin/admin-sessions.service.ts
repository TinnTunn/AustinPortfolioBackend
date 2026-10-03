import { Global, Injectable, Logger, Module, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";

const CACHE_MS = 60_000;
const METADATA_KEY = "sessions_valid_after";

/**
 * Lets a password change sign out every other device. Admin sessions are
 * stateless signed tokens, so instead of a session table we keep one
 * timestamp in the admin's Supabase `app_metadata`: tokens issued before it
 * are rejected. Looked up at most once a minute per user (cached), and
 * updated in the cache immediately when this API changes it.
 */
@Injectable()
export class AdminSessionsService {
  private readonly logger = new Logger(AdminSessionsService.name);
  private readonly cache = new Map<string, { validAfter: number | null; at: number }>();

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Unix seconds before which this user's tokens are invalid (0 = none), or
   * null when the user no longer exists. Throws 503 if it can't be checked
   * and nothing is cached — admin access fails closed.
   */
  async validAfter(userId: string): Promise<number | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.validAfter;

    const { data, error } = await this.db.auth.admin.getUserById(userId);
    if (error) {
      // 4xx (other than rate limiting) means this user id isn't usable: treat as gone.
      const status = error.status ?? 0;
      if ((status >= 400 && status < 500 && status !== 429) || /not found/i.test(error.message)) {
        this.cache.set(userId, { validAfter: null, at: Date.now() });
        return null;
      }
      this.logger.error(`Couldn't check admin sessions: ${error.message}`);
      if (hit) return hit.validAfter; // stale beats locking the admin out
      throw new ServiceUnavailableException("Can't verify the session right now. Please try again.");
    }
    const raw = Number(data.user.app_metadata?.[METADATA_KEY] ?? 0);
    const validAfter = Number.isFinite(raw) ? raw : 0;
    this.cache.set(userId, { validAfter, at: Date.now() });
    return validAfter;
  }

  /** Invalidates every token for this user issued before `nowSeconds`. */
  async revokeBefore(userId: string, nowSeconds: number) {
    const current = await this.db.auth.admin.getUserById(userId);
    if (current.error) throw new ServiceUnavailableException("Couldn't update the account. Please try again.");
    const { error } = await this.db.auth.admin.updateUserById(userId, {
      app_metadata: { ...current.data.user.app_metadata, [METADATA_KEY]: nowSeconds },
    });
    if (error) {
      this.logger.error(`Couldn't revoke old sessions: ${error.message}`);
      throw new ServiceUnavailableException("Couldn't sign out other devices. Please try again.");
    }
    this.cache.set(userId, { validAfter: nowSeconds, at: Date.now() });
  }

  private get db() {
    if (!this.supabase.client) throw new ServiceUnavailableException("Supabase isn't configured.");
    return this.supabase.client;
  }
}

@Global()
@Module({ providers: [AdminSessionsService], exports: [AdminSessionsService] })
export class AdminSessionsModule {}
