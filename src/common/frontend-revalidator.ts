import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { env } from "../config/env";

type FrontendCacheTag = "content" | "cv";

/**
 * Tells the Next.js frontend to drop a cached resource right away (its
 * POST /api/revalidate, authenticated with INTERNAL_API_KEY). Fire-and-forget:
 * if it fails, the frontend's own cache timeout still catches up.
 */
@Injectable()
export class FrontendRevalidator {
  private readonly logger = new Logger(FrontendRevalidator.name);

  revalidate(tag: FrontendCacheTag) {
    const { frontendUrl, internalApiKey } = env();
    if (!frontendUrl || !internalApiKey) return;
    fetch(`${frontendUrl}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": internalApiKey },
      body: JSON.stringify({ tag }),
      signal: AbortSignal.timeout(5_000),
    })
      .then((res) => {
        if (!res.ok) this.logger.warn(`Frontend revalidation (${tag}) returned ${res.status}`);
      })
      .catch((err: Error) => this.logger.warn(`Frontend revalidation (${tag}) failed: ${err.message}`));
  }
}

@Global()
@Module({ providers: [FrontendRevalidator], exports: [FrontendRevalidator] })
export class FrontendRevalidatorModule {}
