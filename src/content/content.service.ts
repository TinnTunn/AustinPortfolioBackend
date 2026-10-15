import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { FrontendRevalidator } from "../common/frontend-revalidator";
import { FALLBACK_CONTENT } from "./content.fallback";
import { COLUMNS, SECTION_KEYS, type ContentRows, type ExperienceRow, type ProjectRow, type SiteSections } from "./content.types";
import { projectImageUrl } from "./project-images";

// Projects without the image column, for a database where schema.sql hasn't
// been re-run yet — the site keeps working, just without screenshots.
const LEGACY_PROJECT_COLUMNS = COLUMNS.projects.replace(", image_path", "");
const UNDEFINED_COLUMN = "42703";

const CACHE_MS = 5 * 60_000;
const RETRY_AFTER_FAILURE_MS = 30_000;
const QUERY_TIMEOUT_MS = 5_000;

/**
 * Published content for the public site and for Tinn. Kept in memory for a
 * few minutes and dropped the moment an admin edits something; if Supabase is
 * unreachable, the built-in copy is served so the site never looks empty.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  private cache: { rows: ContentRows; at: number } | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly frontend: FrontendRevalidator
  ) {}

  async published(): Promise<ContentRows> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rows;
    try {
      const rows = await this.fetchPublished();
      this.cache = { rows, at: Date.now() };
      return rows;
    } catch (err) {
      this.logger.error(`Using built-in fallback content: ${(err as Error).message}`);
      // Last good copy beats the built-in one. Keep serving it for a short
      // while so an outage doesn't turn every page view into a failing query.
      const rows = this.cache?.rows ?? FALLBACK_CONTENT;
      this.cache = { rows, at: Date.now() - CACHE_MS + RETRY_AFTER_FAILURE_MS };
      return rows;
    }
  }

  /** Called after every admin change: drop our cache and tell the frontend to refetch. */
  invalidate() {
    this.cache = null;
    this.frontend.revalidate("content");
  }

  private async fetchPublished(): Promise<ContentRows> {
    const db = this.supabase.client;
    if (!db) throw new Error("Supabase isn't configured");
    const timeout = () => AbortSignal.timeout(QUERY_TIMEOUT_MS);
    // Same ordering as the admin list, so both always agree (ties broken by age).
    const projectsQuery = (columns: string) =>
      db.from("projects").select(columns).eq("published", true).order("sort_order").order("created_at").abortSignal(timeout());
    const [experiences, firstProjects, sections] = await Promise.all([
      db.from("experiences").select(COLUMNS.experiences).eq("published", true)
        .order("sort_order").order("created_at").abortSignal(timeout()),
      projectsQuery(COLUMNS.projects),
      db.from("site_sections").select("key, data").abortSignal(timeout()),
    ]);
    const projects = firstProjects.error?.code === UNDEFINED_COLUMN ? await projectsQuery(LEGACY_PROJECT_COLUMNS) : firstProjects;
    if (experiences.error) throw new Error(experiences.error.message);
    if (projects.error) throw new Error(projects.error.message);

    return {
      experiences: experiences.data as unknown as ExperienceRow[],
      projects: (projects.data as unknown as ProjectRow[]).map((p) => ({
        ...p,
        image_path: p.image_path ?? null,
        image_url: projectImageUrl(p.image_path),
      })),
      sections: this.toSections(sections),
    };
  }

  /** Site text is optional: if it can't be read, the site shows its built-in text. */
  private toSections(result: { data: unknown; error: { message: string } | null }): SiteSections {
    if (result.error) {
      this.logger.warn(`Site text unavailable, using built-in text: ${result.error.message}`);
      return {};
    }
    const sections: SiteSections = {};
    for (const row of (result.data ?? []) as { key: string; data: unknown }[]) {
      const key = SECTION_KEYS.find((k) => k === row.key);
      if (key && row.data && typeof row.data === "object") sections[key] = row.data as Record<string, unknown>;
    }
    return sections;
  }
}
