import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  InternalServerErrorException,
  Logger,
  Param,
  ParseEnumPipe,
  Put,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SupabaseService } from "../supabase/supabase.service";
import { ContentService } from "../content/content.service";
import { SECTION_KEYS, type SectionKey } from "../content/content.types";
import { OriginGuard } from "../common/origin.guard";
import { ActivityService } from "../activity/activity.service";
import { AdminGuard } from "./admin.guard";
import { AboutSectionDto, GoalsSectionDto, HeroSectionDto, SkillsSectionDto } from "./sections.dto";

const SECTION_ENUM = Object.fromEntries(SECTION_KEYS.map((k) => [k, k])) as Record<SectionKey, SectionKey>;
const NAMES: Record<SectionKey, string> = { hero: "Hero", about: "About", skills: "Skills", goals: "Goals" };

@Injectable()
export class AdminSectionsService {
  private readonly logger = new Logger(AdminSectionsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly content: ContentService
  ) {}

  private get db() {
    if (!this.supabase.client) throw new ServiceUnavailableException("Supabase isn't configured.");
    return this.supabase.client;
  }

  private fail(error: { code?: string; message: string }): never {
    if (error.code === "PGRST205" || error.code === "42P01") {
      throw new ServiceUnavailableException("Site text needs the latest database setup — re-run supabase/schema.sql.");
    }
    this.logger.error(`${error.code ?? ""} ${error.message}`);
    throw new InternalServerErrorException("The database couldn't complete that request.");
  }

  /** Every section's saved text, or null where the site uses its built-in text. */
  async all() {
    const { data, error } = await this.db.from("site_sections").select("key, data, updated_at");
    if (error) this.fail(error);
    const out: Record<SectionKey, { data: unknown; updatedAt: string } | null> = { hero: null, about: null, skills: null, goals: null };
    for (const row of data) {
      const key = SECTION_KEYS.find((k) => k === row.key);
      if (key) out[key] = { data: row.data, updatedAt: row.updated_at as string };
    }
    return out;
  }

  async save(key: SectionKey, data: object) {
    const { error } = await this.db
      .from("site_sections")
      .upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) this.fail(error);
    this.content.invalidate();
  }

  async reset(key: SectionKey) {
    const { error } = await this.db.from("site_sections").delete().eq("key", key);
    if (error) this.fail(error);
    this.content.invalidate();
  }
}

/** Text of the Hero, About, Skills, and Goals sections. One route per section, each with its own strict DTO. */
@Controller("admin/sections")
@UseGuards(OriginGuard, AdminGuard)
export class AdminSectionsController {
  constructor(
    private readonly sections: AdminSectionsService,
    private readonly activity: ActivityService
  ) {}

  @Get() all() { return this.sections.all(); }

  @Put("hero") @HttpCode(204) hero(@Body() dto: HeroSectionDto, @Req() req: Request) { return this.save("hero", dto, req); }
  @Put("about") @HttpCode(204) about(@Body() dto: AboutSectionDto, @Req() req: Request) { return this.save("about", dto, req); }
  @Put("skills") @HttpCode(204) skills(@Body() dto: SkillsSectionDto, @Req() req: Request) { return this.save("skills", dto, req); }
  @Put("goals") @HttpCode(204) goals(@Body() dto: GoalsSectionDto, @Req() req: Request) { return this.save("goals", dto, req); }

  /** Back to the site's built-in text. */
  @Delete(":key")
  @HttpCode(204)
  async reset(@Param("key", new ParseEnumPipe(SECTION_ENUM)) key: SectionKey, @Req() req: Request) {
    await this.sections.reset(key);
    this.activity.log("site.reset", `Reset the ${NAMES[key]} text to the built-in version`, req);
  }

  private async save(key: SectionKey, dto: object, req: Request) {
    await this.sections.save(key, dto);
    this.activity.log("site.update", `Updated the ${NAMES[key]} text`, req);
  }
}
