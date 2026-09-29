import { Global, Injectable, Module } from "@nestjs/common";
import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import WebSocket from "ws";
import { env } from "../config/env";

type RealtimeTransport = NonNullable<NonNullable<SupabaseClientOptions<"public">["realtime"]>["transport"]>;
// `ws` is the implementation supabase-js documents for Node; only its
// overloaded constructor typings differ from supabase's structural type.
const transport = WebSocket as unknown as RealtimeTransport;

/**
 * A Supabase client with the SERVICE ROLE key. Every client in this API is
 * made here, with the same options:
 * - no session storage or token refresh (the server is stateless);
 * - an explicit WebSocket implementation for supabase-js's realtime layer.
 *   Its constructor needs one, and Node only ships a built-in WebSocket from
 *   v22 — without this the API crashes on start on older runtimes.
 */
export function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport },
  });
}

/**
 * The shared service-role client. It bypasses Row Level Security, so it lives
 * only here on the server; every table has RLS on with no policies, so the
 * public anon key can't read or write anything.
 */
@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient | null;

  constructor() {
    const { supabaseUrl, supabaseServiceKey } = env();
    this.client = supabaseUrl && supabaseServiceKey ? createServiceClient(supabaseUrl, supabaseServiceKey) : null;
  }
}

@Global()
@Module({ providers: [SupabaseService], exports: [SupabaseService] })
export class SupabaseModule {}
