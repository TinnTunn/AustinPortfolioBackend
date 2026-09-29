/** Rows of the `experiences` and `projects` tables (see supabase/schema.sql). */

export interface ExperienceRow {
  id: string;
  sort_order: number;
  published: boolean;
  org: string;
  href: string | null;
  tags: string[];
  role_en: string;
  role_id: string;
  period_en: string;
  period_id: string;
  context_en: string;
  context_id: string;
  points_en: string[];
  points_id: string[];
}

export interface ProjectRow {
  id: string;
  sort_order: number;
  published: boolean;
  name: string;
  href: string | null;
  stack: string[];
  role_en: string;
  role_id: string;
  status_en: string;
  status_id: string;
  summary_en: string;
  summary_id: string;
  problem_en: string;
  problem_id: string;
  solution_en: string;
  solution_id: string;
  contribution_en: string;
  contribution_id: string;
  lessons_en: string;
  lessons_id: string;
}

export interface ContentRows {
  experiences: ExperienceRow[];
  projects: ProjectRow[];
}

export type ContentTable = "experiences" | "projects";

export const COLUMNS: Record<ContentTable, string> = {
  experiences:
    "id, sort_order, published, org, href, tags, role_en, role_id, period_en, period_id, context_en, context_id, points_en, points_id",
  projects:
    "id, sort_order, published, name, href, stack, role_en, role_id, status_en, status_id, summary_en, summary_id, problem_en, problem_id, solution_en, solution_id, contribution_en, contribution_id, lessons_en, lessons_id",
};
