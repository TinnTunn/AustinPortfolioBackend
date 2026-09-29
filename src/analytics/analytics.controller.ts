import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { InternalKeyGuard } from "../common/internal-key.guard";
import { OriginGuard } from "../common/origin.guard";
import { AdminGuard } from "../admin/admin.guard";
import { AdminContentService } from "../admin/admin-content.service";
import { AnalyticsService } from "./analytics.service";
import { VisitDto } from "./visit.dto";

@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly content: AdminContentService
  ) {}

  /** Server-to-server from the frontend; the key stops anyone inflating the numbers. */
  @Post("visits")
  @HttpCode(204)
  @SkipThrottle() // every call comes from the frontend server's IP
  @UseGuards(InternalKeyGuard)
  async visit(@Body() dto: VisitDto) {
    await this.analytics.record(dto);
  }

  @Get("admin/stats")
  @UseGuards(OriginGuard, AdminGuard)
  async stats() {
    const [visits, counts] = await Promise.all([this.analytics.stats(), this.content.counts().catch(() => null)]);
    return { visits, counts };
  }
}
