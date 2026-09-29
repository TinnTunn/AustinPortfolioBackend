import { Global, Injectable, Module } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

/**
 * Supabase with the SERVICE ROLE key. It bypasses Row Level Security, so it
 * lives only here on the server; every table has RLS on with no policies, so
 * the public anon key can't read or write anything.
 */
@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient | null;

  constructor() {
    const { supabaseUrl, supabaseServiceKey } = env();
    this.client =
      supabaseUrl && supabaseServiceKey
        ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })
        : null;
  }
}

@Global()
@Module({ providers: [SupabaseService], exports: [SupabaseService] })
export class SupabaseModule {}
