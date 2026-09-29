import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/** Constant-time string comparison (length is not secret here). */
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hmacHex(secret: string, message: string) {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** The caller's IP. `trust proxy` is set in main.ts, so this honours Railway's proxy header. */
export function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}
