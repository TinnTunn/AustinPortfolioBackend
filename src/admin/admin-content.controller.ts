import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { OriginGuard } from "../common/origin.guard";
import { AdminGuard } from "./admin.guard";
import { AdminContentService } from "./admin-content.service";
import { ExperienceDto, MoveDto, ProjectDto, PublishDto } from "./admin.dto";

/** Route params must be UUIDs; anything else is rejected before any query runs. */
const Id = () => Param("id", new ParseUUIDPipe());

@Controller("admin/experiences")
@UseGuards(OriginGuard, AdminGuard)
export class AdminExperiencesController {
  constructor(private readonly content: AdminContentService) {}

  @Get() list() { return this.content.list("experiences"); }
  @Get(":id") get(@Id() id: string) { return this.content.get("experiences", id); }
  @Post() create(@Body() dto: ExperienceDto) { return this.content.create("experiences", dto); }
  @Put(":id") update(@Id() id: string, @Body() dto: ExperienceDto) { return this.content.update("experiences", id, dto); }
  @Patch(":id/published") @HttpCode(204) publish(@Id() id: string, @Body() dto: PublishDto) { return this.content.setPublished("experiences", id, dto.published); }
  @Post(":id/move") @HttpCode(204) move(@Id() id: string, @Body() dto: MoveDto) { return this.content.move("experiences", id, dto.direction); }
  @Delete(":id") @HttpCode(204) remove(@Id() id: string) { return this.content.remove("experiences", id); }
}

@Controller("admin/projects")
@UseGuards(OriginGuard, AdminGuard)
export class AdminProjectsController {
  constructor(private readonly content: AdminContentService) {}

  @Get() list() { return this.content.list("projects"); }
  @Get(":id") get(@Id() id: string) { return this.content.get("projects", id); }
  @Post() create(@Body() dto: ProjectDto) { return this.content.create("projects", dto); }
  @Put(":id") update(@Id() id: string, @Body() dto: ProjectDto) { return this.content.update("projects", id, dto); }
  @Patch(":id/published") @HttpCode(204) publish(@Id() id: string, @Body() dto: PublishDto) { return this.content.setPublished("projects", id, dto.published); }
  @Post(":id/move") @HttpCode(204) move(@Id() id: string, @Body() dto: MoveDto) { return this.content.move("projects", id, dto.direction); }
  @Delete(":id") @HttpCode(204) remove(@Id() id: string) { return this.content.remove("projects", id); }
}
