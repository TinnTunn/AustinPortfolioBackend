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
import { projectImageUrl } from "../content/project-images";
import type { ExperienceDto, ProjectDto } from "./admin.dto";
import { ProjectImagesService } from "./project-images.service";

/** The column that names an item, for messages and the activity log. */
const LABEL: Record<ContentTable, string> = { experiences: "org", projects: "name" };

type Row = Record<string, unknown>;

/** Adds the public screenshot address to project rows. */
function withImage(table: ContentTable, row: Row) {
  return table === "projects" ? { ...row, image_url: projectImageUrl(row.image_path as string | null) } : row;
}

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
    private readonly content: ContentService,
    private readonly images: ProjectImagesService
  ) {}

  private get db() {
    if (!this.supabase.client) throw new ServiceUnavailableException("Supabase isn't configured.");
    return this.supabase.client;
  }

  /** Logs the details, returns a generic message (no DB internals leak to the client). */
  private fail(error: PostgrestError): never {
    if (error.code === "PGRST205" || error.code === "42P01" || error.code === "42703") {
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
    return (data as unknown as Row[]).map((row) => withImage(table, row));
  }

  async get(table: ContentTable, id: string) {
    const { data, error } = await this.db.from(table).select(COLUMNS[table]).eq("id", id).maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundException();
    return withImage(table, data as unknown as Row);
  }

  async create(table: ContentTable, dto: ExperienceDto | ProjectDto) {
    // New items go to the end of the list.
    const last = await this.db.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
    if (last.error) this.fail(last.error);
    const sortOrder = ((last.data[0]?.sort_order as number | undefined) ?? 0) + 1;

    const { data, error } = await this.db.from(table).insert({ ...dto, sort_order: sortOrder }).select("id").single();
    if (error) this.fail(error);
    this.content.invalidate();
    return data as { id: string };
  }

  async update(table: ContentTable, id: string, dto: ExperienceDto | ProjectDto) {
    const { data, error } = await this.db.from(table)
      .update({ ...dto, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
    this.content.invalidate();
    return data[0];
  }

  /** Returns the item's name (for the activity log). */
  async setPublished(table: ContentTable, id: string, published: boolean) {
    const { data, error } = await this.db.from(table)
      .update({ published, updated_at: new Date().toISOString() }).eq("id", id).select(LABEL[table]);
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
    this.content.invalidate();
    return (data[0] as unknown as Row)[LABEL[table]] as string;
  }

  /** Returns the deleted item's name; a project's screenshot is deleted with it. */
  async remove(table: ContentTable, id: string) {
    const columns = table === "projects" ? `${LABEL[table]}, image_path` : LABEL[table];
    const { data, error } = await this.db.from(table).delete().eq("id", id).select(columns);
    if (error) this.fail(error);
    if (data.length !== 1) throw new NotFoundException();
    this.content.invalidate();
    const row = data[0] as unknown as Row;
    if (typeof row.image_path === "string") await this.images.deleteObject(row.image_path);
    return row[LABEL[table]] as string;
  }

  /**
   * Moves an item one place up or down. The whole list is renumbered 1..n in a
   * single SQL statement (admin_reorder), so it's all-or-nothing: a failure
   * leaves the previous order intact, and positions can never be duplicated.
   */
  /** Returns the moved item's name, or null when it was already at the edge. */
  async move(table: ContentTable, id: string, direction: "up" | "down") {
    const { data, error } = await this.db.from(table).select(`id, ${LABEL[table]}`).order("sort_order").order("created_at");
    if (error) this.fail(error);

    const rows = data as unknown as Row[];
    const ids = rows.map((r) => r.id as string);
    const from = ids.indexOf(id);
    if (from === -1) throw new NotFoundException();
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return null; // already at the edge
    [ids[from], ids[to]] = [ids[to], ids[from]];

    const { error: reorderError } = await this.db.rpc("admin_reorder", { p_table: table, p_ids: ids });
    if (reorderError) {
      if (reorderError.code === "PGRST202") {
        throw new ServiceUnavailableException("Reordering needs the latest database setup — re-run supabase/schema.sql.");
      }
      this.fail(reorderError);
    }
    this.content.invalidate();
    return rows[from][LABEL[table]] as string;
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
