import { Module } from "@nestjs/common";
import { ContentModule } from "../content/content.module";
import { AnalyticsController } from "../analytics/analytics.controller";
import { AnalyticsService } from "../analytics/analytics.service";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminExperiencesController, AdminProjectsController } from "./admin-content.controller";
import { AdminContentService } from "./admin-content.service";
import { AdminInboxController, AdminInboxService } from "./admin-inbox.controller";
import { AdminSectionsController, AdminSectionsService } from "./admin-sections.controller";
import { ProjectImagesService } from "./project-images.service";

@Module({
  imports: [ContentModule],
  controllers: [
    AdminAuthController,
    AdminExperiencesController,
    AdminProjectsController,
    AdminSectionsController,
    AdminInboxController,
    AnalyticsController,
  ],
  providers: [AdminAuthService, AdminContentService, AdminSectionsService, AdminInboxService, ProjectImagesService, AnalyticsService],
})
export class AdminModule {}
