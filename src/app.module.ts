import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { SupabaseModule } from "./supabase/supabase.service";
import { ContentModule } from "./content/content.module";
import { AdminModule } from "./admin/admin.module";
import { ContactController } from "./contact/contact.controller";
import { ContactService } from "./contact/contact.service";
import { ChatController } from "./chat/chat.controller";
import { CvController } from "./cv/cv.controller";
import { CvService } from "./cv/cv.service";
import { HealthModule } from "./health/health";
import { FrontendRevalidatorModule } from "./common/frontend-revalidator";

@Module({
  imports: [
    // Default: 120 requests per minute per IP; stricter limits on the
    // expensive or sensitive routes (login, contact, chat, CV) are set per route.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
    SupabaseModule,
    FrontendRevalidatorModule,
    ContentModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [ContactController, ChatController, CvController],
  providers: [ContactService, CvService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
