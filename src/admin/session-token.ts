import { hmacHex, safeEqual } from "../common/security";

/**
 * Admin session token: base64url(JSON payload) + "." + HMAC-SHA256 signature.
 * Stateless and tamper-proof; rotating ADMIN_SESSION_SECRET (or changing
 * ADMIN_EMAIL) logs every session out.
 */

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  sub: string; // Supabase user id
  email: string;
  iat: number;
  exp: number;
}

const sign = (body: string, secret: string) => Buffer.from(hmacHex(secret, `session|${body}`), "hex").toString("base64url");

export function createToken(user: { id: string; email: string }, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { sub: user.id, email: user.email.toLowerCase(), iat: now, exp: now + SESSION_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token: unknown, secret: string): SessionPayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!safeEqual(signature, sign(body, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      payload.iat > now + 60
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
