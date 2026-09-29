import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { PostgrestError } from "@supabase/supabase-js";
import { SupabaseService } from "../supabase/supabase.service";
import { ContentService } from "../content/content.service";
import { COLUMNS, type ContentTable } from "../content/content.types";
import type { ExperienceDto, ProjectDto } from "./admin.dto";

/**
 * CRUD for the admin panel, drafts included. Only ever called from behind
 * AdminGuard. All queries go through the Supabase query builder, which sends
 * values as parameters — input never becomes part of an SQL string.
 */
@Injectable()
export class AdminContentService {
  private readonly logger = new Logger(AdminContentService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly content: ContentService
  ) {}

  private get db() {
    if (!this.supabase.client) throw new ServiceUnavailableException("Supabase isn't configured.");
    return this.supabase.client;
  }

  /** Logs the details, returns a generic message (no DB internals leak to the client). */
  private fail(error: PostgrestError): never {
    if (error.code === "PGRST205" || error.code === "42P01") {
      throw new ServiceUnavailableException(
        "The content tables don't exist yet — run supabase/schema.sql and supabase/seed-content.sql in the Supabase SQL Editor."
      );
    }
    this.logger.error(`${error.code ?? ""} ${error.message}`);
    throw new InternalServerErrorException("The database couldn't complete that request.");
  }

  async list(table: ContentTable) {
    const { data, error } = await this.db.from(table).select(COLUMNS[table]).order("sort_order").order("created_at");
    if (error) this.fail(error);
    return data;
  }

  async get(table: ContentTable, id: string) {
    const { data, error } = await this.db.from(table).select(COLUMNS[table]).eq("id", id).maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundException();
    return data;
  }

  async create(table: ContentTable, dto: ExperienceDto | ProjectDto) {
    // New items go to the end of the list.
    const last = await this.db.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
    if (last.error) this.fail(last.error);
    const sortOrder = ((last.data[0]?.sort_order as number | undefined) ?? 0) + 1;

    const { data, error } = await this.db.from(table).insert({ ...dto, sort_order: sortOrder }).select("id").single();
    if (error) this.fail(error);
    this.content.invalidate();
    return data;
  }

  async update(table: ContentTable, id: string, dto: ExperienceDto | ProjectDto) {
    const { data, error } = await this.db.from(table)
      .update({ ...dto, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
    this.content.invalidate();
    return data[0];
  }

  async setPublished(table: ContentTable, id: string, published: boolean) {
    const { data, error } = await this.db.from(table)
      .update({ published, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
    this.content.invalidate();
  }

  async remove(table: ContentTable, id: string) {
    const { data, error } = await this.db.from(table).delete().eq("id", id).select("id");
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
    this.content.invalidate();
  }

  /**
   * Moves an item one place up or down. The whole list is renumbered 1..n in a
   * single SQL statement (admin_reorder), so it's all-or-nothing: a failure
   * leaves the previous order intact, and positions can never be duplicated.
   */
  async move(table: ContentTable, id: string, direction: "up" | "down") {
    const { data, error } = await this.db.from(table).select("id").order("sort_order").order("created_at");
    if (error) this.fail(error);

    const ids = data.map((r) => r.id as string);
    const from = ids.indexOf(id);
    if (from === -1) throw new NotFoundException();
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return; // already at the edge
    [ids[from], ids[to]] = [ids[to], ids[from]];

    const { error: reorderError } = await this.db.rpc("admin_reorder", { p_table: table, p_ids: ids });
    if (reorderError) {
      if (reorderError.code === "PGRST202") {
        throw new ServiceUnavailableException("Reordering needs the latest database setup — re-run supabase/schema.sql.");
      }
      this.fail(reorderError);
    }
    this.content.invalidate();
  }

  async counts() {
    const count = async (table: ContentTable, published?: boolean) => {
      let query = this.db.from(table).select("id", { count: "exact", head: true });
      if (published !== undefined) query = query.eq("published", published);
      const { count: n, error } = await query;
      if (error) this.fail(error);
      return n ?? 0;
    };
    const [experiences, experiencesLive, projects, projectsLive] = await Promise.all([
      count("experiences"), count("experiences", true), count("projects"), count("projects", true),
    ]);
    return {
      experiences: { total: experiences, published: experiencesLive },
      projects: { total: projects, published: projectsLive },
    };
  }
}
