import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { memoryStorage } from "multer";
import { OriginGuard } from "../common/origin.guard";
import { ActivityService } from "../activity/activity.service";
import type { ContentTable } from "../content/content.types";
import { AdminGuard } from "./admin.guard";
import { AdminContentService } from "./admin-content.service";
import { ExperienceDto, MoveDto, ProjectDto, PublishDto } from "./admin.dto";
import { PROJECT_IMAGE_MAX_BYTES, ProjectImagesService } from "./project-images.service";

/** Route params must be UUIDs; anything else is rejected before any query runs. */
const Id = () => Param("id", new ParseUUIDPipe());

const NOUN: Record<ContentTable, string> = { experiences: "experience", projects: "project" };

/** CRUD shared by both lists; every change lands in the activity log. */
class ContentActions {
  constructor(
    private readonly table: ContentTable,
    private readonly content: AdminContentService,
    private readonly activity: ActivityService
  ) {}

  private log(req: Request, action: string, summary: string) {
    this.activity.log(`${NOUN[this.table]}.${action}`, summary, req);
  }

  list() { return this.content.list(this.table); }
  get(id: string) { return this.content.get(this.table, id); }

  async create(dto: ExperienceDto | ProjectDto, label: string, req: Request) {
    const created = await this.content.create(this.table, dto);
    this.log(req, "create", `Added ${NOUN[this.table]} “${label}”${dto.published ? "" : " (draft)"}`);
    return created;
  }

  async update(id: string, dto: ExperienceDto | ProjectDto, label: string, req: Request) {
    const updated = await this.content.update(this.table, id, dto);
    this.log(req, "update", `Edited ${NOUN[this.table]} “${label}”`);
    return updated;
  }

  async publish(id: string, published: boolean, req: Request) {
    const label = await this.content.setPublished(this.table, id, published);
    this.log(req, published ? "publish" : "unpublish", `${published ? "Published" : "Unpublished"} ${NOUN[this.table]} “${label}”`);
  }

  async move(id: string, direction: "up" | "down", req: Request) {
    const label = await this.content.move(this.table, id, direction);
    if (label) this.log(req, "move", `Moved ${NOUN[this.table]} “${label}” ${direction}`);
  }

  async remove(id: string, req: Request) {
    const label = await this.content.remove(this.table, id);
    this.log(req, "delete", `Deleted ${NOUN[this.table]} “${label}”`);
  }
}

@Controller("admin/experiences")
@UseGuards(OriginGuard, AdminGuard)
export class AdminExperiencesController {
  private readonly actions: ContentActions;

  constructor(content: AdminContentService, activity: ActivityService) {
    this.actions = new ContentActions("experiences", content, activity);
  }

  @Get() list() { return this.actions.list(); }
  @Get(":id") get(@Id() id: string) { return this.actions.get(id); }
  @Post() create(@Body() dto: ExperienceDto, @Req() req: Request) { return this.actions.create(dto, dto.org, req); }
  @Put(":id") update(@Id() id: string, @Body() dto: ExperienceDto, @Req() req: Request) { return this.actions.update(id, dto, dto.org, req); }
  @Patch(":id/published") @HttpCode(204) publish(@Id() id: string, @Body() dto: PublishDto, @Req() req: Request) { return this.actions.publish(id, dto.published, req); }
  @Post(":id/move") @HttpCode(204) move(@Id() id: string, @Body() dto: MoveDto, @Req() req: Request) { return this.actions.move(id, dto.direction, req); }
  @Delete(":id") @HttpCode(204) remove(@Id() id: string, @Req() req: Request) { return this.actions.remove(id, req); }
}

@Controller("admin/projects")
@UseGuards(OriginGuard, AdminGuard)
export class AdminProjectsController {
  private readonly actions: ContentActions;

  constructor(
    content: AdminContentService,
    private readonly activity: ActivityService,
    private readonly images: ProjectImagesService
  ) {
    this.actions = new ContentActions("projects", content, activity);
  }

  @Get() list() { return this.actions.list(); }
  @Get(":id") get(@Id() id: string) { return this.actions.get(id); }
  @Post() create(@Body() dto: ProjectDto, @Req() req: Request) { return this.actions.create(dto, dto.name, req); }
  @Put(":id") update(@Id() id: string, @Body() dto: ProjectDto, @Req() req: Request) { return this.actions.update(id, dto, dto.name, req); }
  @Patch(":id/published") @HttpCode(204) publish(@Id() id: string, @Body() dto: PublishDto, @Req() req: Request) { return this.actions.publish(id, dto.published, req); }
  @Post(":id/move") @HttpCode(204) move(@Id() id: string, @Body() dto: MoveDto, @Req() req: Request) { return this.actions.move(id, dto.direction, req); }
  @Delete(":id") @HttpCode(204) remove(@Id() id: string, @Req() req: Request) { return this.actions.remove(id, req); }

  /**
   * Screenshot upload. Guards run before the body is read, so only the admin
   * can send a file at all; multer keeps it in memory with hard limits (one
   * file, 3 MB, no other fields), then the bytes are checked to be PNG/JPG/WebP.
   */
  @Put(":id/image")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: PROJECT_IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
    })
  )
  async replaceImage(@Id() id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException("Choose an image to upload.");
    const { name, imageUrl } = await this.images.replace(id, file.buffer);
    this.activity.log("project.image", `Replaced the screenshot of project “${name}”`, req);
    return { image_url: imageUrl };
  }

  @Delete(":id/image")
  @HttpCode(204)
  async removeImage(@Id() id: string, @Req() req: Request) {
    const name = await this.images.remove(id);
    this.activity.log("project.image", `Removed the screenshot of project “${name}”`, req);
  }
}
