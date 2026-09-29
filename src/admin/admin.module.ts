import { Module } from "@nestjs/common";
import { ContentModule } from "../content/content.module";
import { AnalyticsController } from "../analytics/analytics.controller";
import { AnalyticsService } from "../analytics/analytics.service";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminExperiencesController, AdminProjectsController } from "./admin-content.controller";
import { AdminContentService } from "./admin-content.service";

@Module({
  imports: [ContentModule],
  controllers: [AdminAuthController, AdminExperiencesController, AdminProjectsController, AnalyticsController],
  providers: [AdminAuthService, AdminContentService, AnalyticsService],
})
export class AdminModule {}
