/**
 * Typed access to environment variables, read once at startup. Optional
 * features (email, assistant, admin) switch themselves off when their keys
 * are missing instead of crashing the whole API.
 */

const MIN_SECRET_LENGTH = 32;

function optional(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function secret(name: string) {
  const value = optional(name);
  if (value && value.length < MIN_SECRET_LENGTH) {
    console.warn(`[env] ${name} is shorter than ${MIN_SECRET_LENGTH} characters — ignoring it.`);
    return null;
  }
  return value;
}

function list(name: string) {
  return (optional(name) ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function loadEnv() {
  return {
    isProduction: process.env.NODE_ENV === "production",
    port: Number(process.env.PORT) || 4000,
    frontendOrigins: list("FRONTEND_ORIGINS"),
    frontendUrl: optional("FRONTEND_URL")?.replace(/\/+$/, "") ?? null,
    internalApiKey: secret("INTERNAL_API_KEY"),
    supabaseUrl: optional("SUPABASE_URL"),
    supabaseServiceKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
    adminEmail: optional("ADMIN_EMAIL")?.toLowerCase() ?? null,
    adminSessionSecret: secret("ADMIN_SESSION_SECRET"),
    resendApiKey: optional("RESEND_API_KEY"),
    contactNotifyEmail: optional("CONTACT_NOTIFY_EMAIL"),
    geminiApiKey: optional("GEMINI_API_KEY"),
  };
}

type Env = ReturnType<typeof loadEnv>;

let cached: Env | null = null;

/** The environment, loaded on first use (after main.ts has read .env). */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
