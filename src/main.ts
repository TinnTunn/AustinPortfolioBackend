import "reflect-metadata";
import { existsSync } from "node:fs";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { env } from "./config/env";
import { createValidationPipe } from "./common/validation";

async function bootstrap() {
  // Local development reads .env; on Railway the variables come from the service.
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = env();
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: config.isProduction ? ["error", "warn", "log"] : undefined,
  });

  // Railway terminates TLS in front of us; trust its X-Forwarded-For so req.ip
  // (used by rate limiting) is the visitor, not the proxy.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "64kb" });

  app.enableCors({
    // Only our own frontend may call the API from a browser, with cookies.
    origin: (origin, callback) => callback(null, !origin || config.frontendOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type"],
    maxAge: 600,
  });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  if (config.frontendOrigins.length === 0) logger.warn("FRONTEND_ORIGINS is empty — browsers can't call the API.");
  await app.listen(config.port);
  logger.log(`API listening on port ${config.port}`);
}

void bootstrap();
